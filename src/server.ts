/**
 * Focus Shield Standalone Server
 * No Electron - just a simple HTTP API on port 8053.
 *
 * Start with: npx tsx src/server.ts
 * Or build: npx tsc && node dist/server.js
 */

import express, { Request, Response } from 'express';
import http from 'http';
import {
  isDomainBlocked,
  grantAllowance,
  revokeAllowance,
  addBlockedDomain,
  removeBlockedDomain,
  getBlockedDomains,
  getEffectivelyBlockedDomains,
  getActiveAllowances,
  getAllowanceRemaining,
  isDomainDelayed,
  getDelaySeconds,
  recordDelayAccess,
  isInActiveSession,
  updateSessionAccess,
  getDelayedDomains,
  addDelayedDomain,
  removeDelayedDomain,
  getBlockedPaths,
  addBlockedPath,
  removeBlockedPath,
  isHardLocked,
  getHardLockoutUntil,
  getActiveHardLockouts,
  addHardLockout,
  removeHardLockout,
} from './store';
import {
  startProxy,
  getCACertPath,
  setBlockedPaths,
  addBlockedPath as proxyAddBlockedPath,
  removeBlockedPath as proxyRemoveBlockedPath,
  getBlockedPaths as proxyGetBlockedPaths,
} from './proxy';
import {
  enableBlocking,
  disableBlocking,
  hasHostsEntries,
  isDaemonRunning,
  flushDnsCache,
  enforceBlockViaDaemon,
} from './blocker';
import { mountMCP } from './mcp.js';

const app = express();
const API_PORT = 8053;

let shieldActive = false;

app.use(express.json());

// CORS for local requests
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Status endpoint
app.get('/status', async (_req: Request, res: Response) => {
  const daemonRunning = await isDaemonRunning();
  res.json({
    running: true,
    shieldActive,
    daemonRunning,
    blockedDomains: getBlockedDomains().length,
    activeAllowances: getActiveAllowances(),
  });
});

// List blocked domains
app.get('/api/blocked', (_req: Request, res: Response) => {
  res.json({ domains: getBlockedDomains() });
});

// Add domain to blocklist
app.post('/api/block', async (req: Request, res: Response) => {
  const { domain } = req.body;
  if (!domain) {
    res.status(400).json({ error: 'domain required' });
    return;
  }
  addBlockedDomain(domain);

  if (shieldActive) {
    await enableBlocking(getBlockedDomains());
    await flushDnsCache();
    // Aggressively enforce: kill connections and close browser tabs
    // This ensures browsers don't keep using cached DNS or existing connections
    await enforceBlockViaDaemon(domain);
  }

  res.json({ success: true, domain, blocked: true });
});

// Remove domain from blocklist
app.delete('/api/block/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;

  // Hard lockout — refuse to unblock domains with active lockouts
  if (isHardLocked(domain)) {
    const until = getHardLockoutUntil(domain);
    res.status(403).json({
      error: `REFUSED: ${domain} is HARD LOCKED until ${until}. Cannot unblock.`,
    });
    return;
  }

  removeBlockedDomain(domain);

  if (shieldActive) {
    await enableBlocking(getBlockedDomains());
  }

  res.json({ success: true, domain, blocked: false });
});

// Check if domain is blocked
app.get('/api/check/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  const blocked = isDomainBlocked(domain);
  const allowanceMinutes = getAllowanceRemaining(domain);
  res.json({ domain, blocked, allowanceMinutes, shieldActive });
});

// Grant temporary access
app.post('/api/grant', async (req: Request, res: Response) => {
  const { domain, minutes, reason } = req.body;
  if (!domain || !minutes) {
    res.status(400).json({ error: 'domain and minutes required' });
    return;
  }

  // Hard lockout — refuse domains with active lockouts
  if (isHardLocked(domain)) {
    const until = getHardLockoutUntil(domain);
    res.status(403).json({
      error: `REFUSED: ${domain} is HARD LOCKED until ${until}. No exceptions.`,
    });
    return;
  }

  const allowance = grantAllowance(domain, minutes, reason || 'Granted via API');

  if (shieldActive) {
    // Use effectively blocked domains (excludes domains with active allowances)
    await enableBlocking(getEffectivelyBlockedDomains());
  }

  res.json({
    success: true,
    domain,
    minutes,
    expiresAt: allowance.expiresAt,
  });
});

// Revoke allowance
app.delete('/api/grant/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  revokeAllowance(domain);

  if (shieldActive) {
    // Use effectively blocked domains (re-add revoked domain to hosts)
    await enableBlocking(getEffectivelyBlockedDomains());
  }

  // Tell daemon to kill existing connections (instant reblock)
  const { revokeAllowanceViaDaemon } = await import('./blocker.js');
  await revokeAllowanceViaDaemon(domain);

  res.json({ success: true, domain, revoked: true });
});

// List active allowances
app.get('/api/allowances', (_req: Request, res: Response) => {
  res.json({ allowances: getActiveAllowances() });
});

// Enable shield
app.post('/api/shield/enable', async (_req: Request, res: Response) => {
  // Use effectively blocked domains to respect active allowances
  const success = await enableBlocking(getEffectivelyBlockedDomains());
  if (success) {
    shieldActive = true;
    res.json({ success: true, shieldActive: true });
  } else {
    res.status(500).json({ error: 'Failed to enable shield - is daemon running?' });
  }
});

// Disable shield
app.post('/api/shield/disable', async (_req: Request, res: Response) => {
  const success = await disableBlocking();
  shieldActive = false;
  res.json({ success: true, shieldActive: false });
});

// List delayed domains
app.get('/api/delayed', (_req: Request, res: Response) => {
  res.json({ domains: getDelayedDomains() });
});

// Add domain to delay list
app.post('/api/delay', (req: Request, res: Response) => {
  const { domain } = req.body;
  if (!domain) {
    res.status(400).json({ error: 'domain required' });
    return;
  }
  addDelayedDomain(domain);
  res.json({ success: true, domain, delayed: true });
});

// Remove from delay list
app.delete('/api/delay/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  removeDelayedDomain(domain);
  res.json({ success: true, domain, delayed: false });
});

// Check delay status
app.get('/api/check-delay/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;

  if (!isDomainDelayed(domain)) {
    res.json({ delayed: false, passThrough: true });
    return;
  }

  if (isInActiveSession(domain)) {
    updateSessionAccess(domain);
    res.json({ delayed: true, inSession: true, passThrough: true });
    return;
  }

  const delaySeconds = getDelaySeconds(domain);
  res.json({
    delayed: true,
    inSession: false,
    delaySeconds,
  });
});

// Record delay completion
app.post('/api/delay-complete', (req: Request, res: Response) => {
  const { domain } = req.body;
  if (!domain) {
    res.status(400).json({ error: 'domain required' });
    return;
  }
  recordDelayAccess(domain);
  res.json({ success: true, message: 'Access recorded' });
});

// === Path blocking API ===

// List blocked paths
app.get('/api/paths', (_req: Request, res: Response) => {
  res.json({ paths: getBlockedPaths() });
});

// Add blocked path
app.post('/api/path', (req: Request, res: Response) => {
  const { domain, path } = req.body;
  if (!domain || !path) {
    res.status(400).json({ error: 'domain and path required' });
    return;
  }
  addBlockedPath(domain, path);
  proxyAddBlockedPath(domain, path);
  res.json({ success: true, domain, path, blocked: true });
});

// Remove blocked path
app.delete('/api/path', (req: Request, res: Response) => {
  const { domain, path } = req.body;
  if (!domain || !path) {
    res.status(400).json({ error: 'domain and path required' });
    return;
  }
  removeBlockedPath(domain, path);
  proxyRemoveBlockedPath(domain, path);
  res.json({ success: true, domain, path, blocked: false });
});

// Get CA cert path for installation
app.get('/api/proxy/ca', (_req: Request, res: Response) => {
  res.json({ path: getCACertPath() });
});

// Flush DNS cache (calls daemon which runs as root)
app.post('/api/flush-dns', async (_req: Request, res: Response) => {
  try {
    await flushDnsCache();
    res.json({ success: true, message: 'DNS cache flushed' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to flush DNS', details: String(e) });
  }
});

// === Hard lockout management ===

// List active hard lockouts
app.get('/api/locks', (_req: Request, res: Response) => {
  res.json({ lockouts: getActiveHardLockouts() });
});

// Add a hard lockout
app.post('/api/lock', (req: Request, res: Response) => {
  const { domain, until } = req.body;
  if (!domain || !until) {
    res.status(400).json({ error: 'domain and until (ISO date) required' });
    return;
  }
  addHardLockout(domain, until);
  res.json({ success: true, domain, until });
});

// Remove a hard lockout
app.delete('/api/lock/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  removeHardLockout(domain);
  res.json({ success: true, domain, removed: true });
});

// Allowance expiry checker
let lastAllowanceCount = 0;
async function checkAllowanceExpiry(): Promise<void> {
  const current = getActiveAllowances().length;
  if (current < lastAllowanceCount && shieldActive) {
    console.log(`Allowance expired (${lastAllowanceCount} -> ${current}), refreshing...`);
    // Re-block expired domains
    await enableBlocking(getEffectivelyBlockedDomains());
  }
  lastAllowanceCount = current;
}

// Start server
async function start(): Promise<void> {
  // Check daemon
  const daemonRunning = await isDaemonRunning();
  if (!daemonRunning) {
    console.error('⚠️  Daemon not running. Start with: sudo node daemon/daemon.cjs');
  }

  // Enable blocking on startup (respecting any existing allowances)
  const effectivelyBlocked = getEffectivelyBlockedDomains();
  const success = await enableBlocking(effectivelyBlocked);
  shieldActive = success;
  lastAllowanceCount = getActiveAllowances().length;

  // Load blocked paths into proxy
  const paths = getBlockedPaths();
  const pathMap = new Map<string, string[]>();
  for (const [domain, patterns] of Object.entries(paths)) {
    pathMap.set(domain, patterns);
  }
  setBlockedPaths(pathMap);

  // Start proxy server
  startProxy();
  console.log('   Configure system proxy: System Settings → Network → Wi-Fi → Details → Proxies');
  console.log('   Set HTTP & HTTPS proxy to: 127.0.0.1:8080');

  // Mount MCP endpoint for Claude Web access via Cloudflare Tunnel
  mountMCP(app, () => shieldActive);

  // Start expiry checker
  setInterval(checkAllowanceExpiry, 30000);

  // Start HTTP server
  const server = http.createServer(app);
  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`🛡️  Focus Shield API running on http://127.0.0.1:${API_PORT}`);
    console.log(`   Shield active: ${shieldActive}`);
    console.log(`   Blocked domains: ${getBlockedDomains().length} (${effectivelyBlocked.length} effective)`);
    console.log(`   Delayed domains: ${getDelayedDomains().length}`);
  });
}

start().catch(console.error);
