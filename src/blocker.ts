/**
 * Blocker module for Focus Shield (standalone).
 * Communicates with the daemon at /tmp/focusshield.sock.
 */

import http from 'http';
import { execSync } from 'child_process';

const DAEMON_SOCKET = '/tmp/focusshield.sock';

interface DaemonResponse {
  success?: boolean;
  error?: string;
  running?: boolean;
  [key: string]: unknown;
}

function log(msg: string): void {
  console.log(`[blocker] ${msg}`);
}

function logError(msg: string, err?: unknown): void {
  console.error(`[blocker] ${msg}`, err || '');
}

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

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await daemonRequest('GET', '/status');
    return res.running === true;
  } catch {
    return false;
  }
}

async function syncBlocklistWithDaemon(domains: string[]): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/blocklist', { domains });
    if (res.success) {
      log(`Synced ${domains.length} domains with daemon`);
      return true;
    }
    logError('Daemon rejected blocklist sync:', res.error);
    return false;
  } catch (err) {
    logError('Failed to sync blocklist with daemon:', err);
    return false;
  }
}

async function updateHostsFile(): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/hosts', {});
    if (res.success) {
      log('Hosts file updated via daemon');
      return true;
    }
    logError('Daemon rejected hosts update:', res.error);
    return false;
  } catch (err) {
    logError('Failed to update hosts file:', err);
    return false;
  }
}

// Tell daemon to revoke allowance and kill existing connections
export async function revokeAllowanceViaDaemon(domain: string): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/revoke', { domain });
    if (res.success) {
      log(`Revoked allowance via daemon: ${domain} (connections killed)`);
      return true;
    }
    logError('Daemon rejected revoke:', res.error);
    return false;
  } catch (err) {
    logError('Failed to revoke via daemon:', err);
    return false;
  }
}

// Aggressively enforce a new block: kill connections and close browser tabs
// This ensures browsers don't keep using cached DNS or existing connections
export async function enforceBlockViaDaemon(domain: string): Promise<boolean> {
  try {
    const res = await daemonRequest('POST', '/enforce-block', { domain });
    if (res.success) {
      log(`Block enforced via daemon: ${domain} (connections killed, tabs closed)`);
      return true;
    }
    logError('Daemon rejected enforce-block:', res.error);
    return false;
  } catch (err) {
    logError('Failed to enforce block via daemon:', err);
    return false;
  }
}

export async function flushDnsCache(): Promise<void> {
  try {
    // Call daemon which runs as root - can flush DNS without sudo
    const res = await daemonRequest('POST', '/flush-dns', {});
    if (res.success) {
      log('DNS cache flushed via daemon');
    } else {
      // Fallback to direct call (may fail without sudo)
      execSync('dscacheutil -flushcache', { stdio: 'ignore' });
      execSync('killall -HUP mDNSResponder 2>/dev/null || true', { stdio: 'ignore' });
      log('DNS cache flushed (direct)');
    }
  } catch {
    // Fallback to direct call
    try {
      execSync('dscacheutil -flushcache', { stdio: 'ignore' });
      log('DNS cache flushed (fallback)');
    } catch {
      // Ignore errors
    }
  }
}

export async function enableBlocking(domains: string[]): Promise<boolean> {
  try {
    if (!(await isDaemonRunning())) {
      logError('Daemon is not running. Start it with: sudo node daemon/daemon.js');
      return false;
    }

    log('Syncing blocklist with daemon...');
    await syncBlocklistWithDaemon(domains);

    log('Enabling blocking via daemon...');
    const res = await daemonRequest('POST', '/enable', {});
    if (!res.success) {
      logError('Failed to enable blocking via daemon');
      return false;
    }

    await flushDnsCache();
    log('Blocking enabled');
    return true;
  } catch (err) {
    logError('Failed to enable blocking:', err);
    return false;
  }
}

export async function disableBlocking(): Promise<boolean> {
  try {
    if (!(await isDaemonRunning())) {
      logError('Daemon is not running');
      return false;
    }

    const res = await daemonRequest('POST', '/disable', {});
    if (res.success) {
      await flushDnsCache();
      log('Blocking disabled');
      return true;
    }
    return false;
  } catch (err) {
    logError('Failed to disable blocking:', err);
    return false;
  }
}

// Compatibility exports
export const updateHostsFileWithSudo = enableBlocking;
export const clearHostsEntries = disableBlocking;
export async function hasHostsEntries(): Promise<boolean> {
  try {
    const res = await daemonRequest('GET', '/status');
    return res.shieldActive === true;
  } catch {
    return false;
  }
}
