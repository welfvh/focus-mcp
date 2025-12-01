/**
 * Dual-layer blocker for Focus Shield (learned from SelfControl).
 *
 * Uses BOTH:
 * 1. /etc/hosts file - Catches DNS at the OS level (primary for domains like YouTube/Google)
 * 2. pf (packet filter) - Catches direct IP connections (backup)
 *
 * Why both? Google/YouTube use many rotating IPs. Hosts file blocks the domain
 * name itself, so no matter what IP DNS returns, it goes to 127.0.0.1.
 * pf catches any hardcoded IPs or direct connections.
 *
 * Privileged operations are handled by a daemon at /tmp/focusshield.sock to
 * avoid repeated password prompts. The daemon exposes an HTTP API over Unix socket.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve4, resolve6 } from 'dns';
import { isDomainBlocked } from './store';
import * as http from 'http';

const execAsync = promisify(exec);
const resolve4Async = promisify(resolve4);
const resolve6Async = promisify(resolve6);

const DAEMON_SOCKET = '/tmp/focusshield.sock';
const ANCHOR_NAME = 'com.welf.focusshield';

// Safe logging that won't throw EPIPE when stdout is disconnected (common in Electron menu bar apps)
function log(msg: string): void {
  try {
    console.log(msg);
  } catch {
    // Ignore EPIPE errors
  }
}

function logError(msg: string, err?: unknown): void {
  try {
    console.error(msg, err);
  } catch {
    // Ignore EPIPE errors
  }
}

interface DaemonResponse {
  success?: boolean;
  running?: boolean;
  error?: string;
}

/**
 * Send a request to the privileged daemon via Unix socket.
 */
async function daemonRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: object
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DAEMON_SOCKET,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid response from daemon: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Daemon connection failed: ${err.message}. Is the daemon running?`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Check if the daemon is running.
 */
async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await daemonRequest('GET', '/status');
    return res.running === true;
  } catch {
    return false;
  }
}

interface ResolvedIPs {
  ipv4: string[];
  ipv6: string[];
}

/**
 * Resolve a domain to both IPv4 and IPv6 addresses.
 */
async function resolveToIPs(domain: string): Promise<ResolvedIPs> {
  const result: ResolvedIPs = { ipv4: [], ipv6: [] };

  try {
    const ipv4 = await resolve4Async(domain);
    result.ipv4 = Array.isArray(ipv4) ? ipv4 : [ipv4];
  } catch {
    // No IPv4
  }

  try {
    const ipv6 = await resolve6Async(domain);
    result.ipv6 = Array.isArray(ipv6) ? ipv6 : [ipv6];
  } catch {
    // No IPv6
  }

  return result;
}

/**
 * Generate pf rules for blocking domains.
 * Only uses resolved IPs - CIDR ranges are too broad and block unrelated services
 * (e.g., YouTube CIDR ranges block all of Google).
 * The hosts file is the primary blocking mechanism.
 */
async function generatePfRules(domains: string[]): Promise<string> {
  const activeBlocks = domains.filter(d => isDomainBlocked(d));

  if (activeBlocks.length === 0) {
    return '# No domains blocked\n';
  }

  // Only use resolved IPs - no CIDR ranges (they're too broad)
  const ipv4Set = new Set<string>();
  const ipv6Set = new Set<string>();

  for (const domain of activeBlocks) {
    // Resolved IPs (specific addresses)
    const ips = await resolveToIPs(domain);
    ips.ipv4.forEach(ip => ipv4Set.add(ip));
    ips.ipv6.forEach(ip => ipv6Set.add(ip));

    // Also try www. variant
    if (!domain.startsWith('www.')) {
      const wwwIps = await resolveToIPs(`www.${domain}`);
      wwwIps.ipv4.forEach(ip => ipv4Set.add(ip));
      wwwIps.ipv6.forEach(ip => ipv6Set.add(ip));
    }
  }

  // Generate block rules (using 'block return quick' for fast fail)
  const rules = [
    '# Focus Shield - Distraction Blocker',
    `# Blocking ${activeBlocks.length} domains`,
    `# Resolved: ${ipv4Set.size} IPv4, ${ipv6Set.size} IPv6`,
    `# Note: Hosts file is primary block, pf is backup for current IPs only`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  // Block specific resolved IPs
  for (const ip of ipv4Set) {
    rules.push(`block return out quick proto tcp from any to ${ip}`);
    rules.push(`block return out quick proto udp from any to ${ip}`);
  }
  for (const ip of ipv6Set) {
    rules.push(`block return out quick proto tcp from any to ${ip}`);
    rules.push(`block return out quick proto udp from any to ${ip}`);
  }

  return rules.join('\n') + '\n';
}

/**
 * Flush DNS cache locally (daemon also does this, but belt-and-suspenders).
 */
async function flushDnsCache(): Promise<void> {
  try {
    await execAsync('dscacheutil -flushcache');
    await execAsync('killall -HUP mDNSResponder 2>/dev/null || true');
    log('DNS cache flushed');
  } catch (err) {
    logError('Failed to flush DNS cache:', err);
  }
}

/**
 * Collect all domains to block including www. variants and common subdomains.
 */
function collectAllDomainsToBlock(domains: string[]): string[] {
  const activeBlocks = domains.filter(d => isDomainBlocked(d));
  const allDomains = new Set<string>();

  for (const domain of activeBlocks) {
    allDomains.add(domain);

    // Add www variant
    if (!domain.startsWith('www.')) {
      allDomains.add(`www.${domain}`);
    }

    // Add common subdomains for major sites
    const commonSubdomains = getCommonSubdomains(domain);
    for (const sub of commonSubdomains) {
      allDomains.add(sub);
    }
  }

  return Array.from(allDomains);
}

/**
 * Get common subdomains for popular sites (like SelfControl does).
 */
function getCommonSubdomains(domain: string): string[] {
  const subs: string[] = [];

  // YouTube specific subdomains
  if (domain.includes('youtube.com')) {
    subs.push(
      'm.youtube.com',
      'music.youtube.com',
      'gaming.youtube.com',
      'youtu.be',
      'youtube-nocookie.com',
      'www.youtube-nocookie.com',
      'youtubei.googleapis.com',
      'youtube.googleapis.com',
      'www.googleadservices.com', // ads
    );
  }

  // Twitter/X specific
  if (domain.includes('twitter.com') || domain.includes('x.com')) {
    subs.push(
      'mobile.twitter.com',
      'api.twitter.com',
      'mobile.x.com',
      'api.x.com',
    );
  }

  // Reddit specific
  if (domain.includes('reddit.com')) {
    subs.push(
      'old.reddit.com',
      'new.reddit.com',
      'i.reddit.com',
      'np.reddit.com',
      'oauth.reddit.com',
      'www.redditmedia.com',
      'redditmedia.com',
    );
  }

  // Facebook/Instagram specific
  if (domain.includes('facebook.com')) {
    subs.push(
      'm.facebook.com',
      'mobile.facebook.com',
      'touch.facebook.com',
      'web.facebook.com',
    );
  }

  if (domain.includes('instagram.com')) {
    subs.push(
      'm.instagram.com',
      'i.instagram.com',
      'graph.instagram.com',
    );
  }

  // TikTok specific
  if (domain.includes('tiktok.com')) {
    subs.push(
      'm.tiktok.com',
      'www.tiktok.com',
      'vm.tiktok.com',
    );
  }

  return subs;
}

/**
 * Add hosts entries via daemon (which has root privileges).
 * Daemon expects {"entries": ["0.0.0.0 domain.com", ...]} format.
 */
async function addHostsEntries(domains: string[]): Promise<boolean> {
  const allDomains = collectAllDomainsToBlock(domains);

  if (allDomains.length === 0) {
    log('No hosts entries to add');
    return true;
  }

  // Format as hosts file entries (null-route both IPv4 and IPv6)
  const entries: string[] = [];
  for (const domain of allDomains) {
    entries.push(`0.0.0.0 ${domain}`);
    entries.push(`:: ${domain}`);
  }

  try {
    const res = await daemonRequest('POST', '/hosts', { entries });
    if (res.success) {
      log(`Hosts entries added for ${allDomains.length} domains`);
      return true;
    } else {
      logError('Daemon rejected hosts update:', res.error);
      return false;
    }
  } catch (err) {
    logError('Failed to add hosts entries:', err);
    return false;
  }
}

/**
 * Remove hosts entries via daemon (send empty entries array).
 */
async function removeHostsEntries(): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/hosts', { entries: [] });
    if (res.success) {
      log('Hosts entries removed');
      return true;
    } else {
      logError('Daemon rejected hosts clear:', res.error);
      return false;
    }
  } catch (err) {
    logError('Failed to remove hosts entries:', err);
    return false;
  }
}

/**
 * Update pf rules via daemon.
 */
async function updatePfRules(rules: string): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/pf', { rules });
    if (res.success) {
      log('PF rules updated');
      return true;
    } else {
      logError('Daemon rejected pf update:', res.error);
      return false;
    }
  } catch (err) {
    logError('Failed to update pf rules:', err);
    return false;
  }
}

/**
 * Pulse pf to kill existing connections to blocked domains.
 * Briefly blocks IPs via pf (sends RST), then clears rules.
 * This forces browsers to drop keep-alive connections.
 */
export async function pfPulseKill(domains: string[]): Promise<void> {
  try {
    // Resolve current IPs for domains
    const ipsToBlock = new Set<string>();
    for (const domain of domains.slice(0, 20)) { // Limit to avoid too many DNS lookups
      try {
        const ips = await resolveToIPs(domain);
        ips.ipv4.forEach(ip => ipsToBlock.add(ip));
      } catch {
        // Skip domains that don't resolve
      }
    }

    if (ipsToBlock.size === 0) {
      log('No IPs to pulse-block');
      return;
    }

    // Build pf rules
    const rules: string[] = ['# Pulse kill - temporary block to reset connections'];
    for (const ip of ipsToBlock) {
      rules.push(`block return out quick proto tcp from any to ${ip}`);
    }

    log(`Pulsing pf to kill ${ipsToBlock.size} IPs...`);
    await updatePfRules(rules.join('\n'));

    // Wait 3 seconds for connections to die
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Clear pf rules
    await updatePfRules('# Pulse complete - cleared\n');
    log('PF pulse complete - connections killed');
  } catch (err) {
    logError('PF pulse failed:', err);
    // Clear pf rules anyway to avoid leaving blocks
    await updatePfRules('# Cleared after error\n');
  }
}

/**
 * Enable dual-layer blocking (hosts file + pf).
 * All privileged operations go through the daemon at /tmp/focusshield.sock.
 */
export async function enableBlocking(domains: string[]): Promise<boolean> {
  try {
    // Check daemon is running
    if (!(await isDaemonRunning())) {
      logError('Focus Shield daemon is not running. Start it first.');
      return false;
    }

    // LAYER 1: Hosts file (primary - catches DNS regardless of IP rotation)
    log('Adding hosts file entries via daemon...');
    const hostsOk = await addHostsEntries(domains);
    if (!hostsOk) {
      logError('Failed to add hosts entries');
      return false;
    }

    // LAYER 2: pf rules DISABLED - YouTube IPs overlap with Google services
    // and blocking them breaks Google Search, Gmail, etc.
    // Hosts-only blocking is sufficient and safer.
    // Clear any stale pf rules from previous sessions
    await updatePfRules('# Focus Shield - pf layer disabled (hosts-only mode)\n');

    // Flush DNS cache locally as well (daemon does this too)
    await flushDnsCache();

    log('Blocking enabled (hosts-only mode)');
    return true;
  } catch (err) {
    logError('Failed to enable blocking:', err);
    return false;
  }
}

/**
 * Disable dual-layer blocking.
 * All privileged operations go through the daemon.
 */
export async function disableBlocking(): Promise<boolean> {
  try {
    // Check daemon is running
    if (!(await isDaemonRunning())) {
      logError('Focus Shield daemon is not running. Start it first.');
      return false;
    }

    // Remove hosts file entries
    log('Removing hosts file entries via daemon...');
    await removeHostsEntries();

    // Clear pf rules
    log('Clearing pf rules via daemon...');
    await updatePfRules('# Focus Shield disabled\n');

    // Flush DNS cache locally
    await flushDnsCache();

    log('Dual-layer blocking disabled');
    return true;
  } catch (err) {
    logError('Failed to disable blocking:', err);
    return false;
  }
}

/**
 * Check if blocking is currently active.
 */
export async function isBlockingActive(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`/sbin/pfctl -a "${ANCHOR_NAME}" -s rules 2>&1 || true`);
    return stdout.includes('block');
  } catch {
    return false;
  }
}

/**
 * Refresh blocking rules (e.g., after granting an allowance).
 */
export async function refreshBlocking(domains: string[]): Promise<boolean> {
  const active = await isBlockingActive();
  if (active) {
    return enableBlocking(domains);
  }
  return true;
}

/**
 * One-time setup - daemon handles pf.conf setup automatically when needed.
 */
export async function setupPfAnchor(): Promise<boolean> {
  // Daemon handles anchor setup automatically when enabling pf rules
  return isDaemonRunning();
}

// Legacy exports for compatibility
export const hasHostsEntries = isBlockingActive;
export const clearHostsEntries = disableBlocking;
export async function updateHostsFileWithSudo(domains: string[]): Promise<boolean> {
  return enableBlocking(domains);
}
