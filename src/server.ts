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
} from './store';
import {
  enableBlocking,
  disableBlocking,
  hasHostsEntries,
  isDaemonRunning,
  flushDnsCache,
} from './blocker';

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
  }

  res.json({ success: true, domain, blocked: true });
});

// Remove domain from blocklist
app.delete('/api/block/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
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

  const allowance = grantAllowance(domain, minutes, reason || 'Granted via API');

  if (shieldActive) {
    await enableBlocking(getBlockedDomains());
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
    await enableBlocking(getBlockedDomains());
  }

  res.json({ success: true, domain, revoked: true });
});

// List active allowances
app.get('/api/allowances', (_req: Request, res: Response) => {
  res.json({ allowances: getActiveAllowances() });
});

// Enable shield
app.post('/api/shield/enable', async (_req: Request, res: Response) => {
  const success = await enableBlocking(getBlockedDomains());
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

// Allowance expiry checker
let lastAllowanceCount = 0;
async function checkAllowanceExpiry(): Promise<void> {
  const current = getActiveAllowances().length;
  if (current < lastAllowanceCount && shieldActive) {
    console.log(`Allowance expired (${lastAllowanceCount} -> ${current}), refreshing...`);
    await enableBlocking(getBlockedDomains());
  }
  lastAllowanceCount = current;
}

// Start server
async function start(): Promise<void> {
  // Check daemon
  const daemonRunning = await isDaemonRunning();
  if (!daemonRunning) {
    console.error('⚠️  Daemon not running. Start with: sudo node daemon/daemon.js');
  }

  // Enable blocking on startup
  const blocked = getBlockedDomains();
  const success = await enableBlocking(blocked);
  shieldActive = success;
  lastAllowanceCount = getActiveAllowances().length;

  // Start expiry checker
  setInterval(checkAllowanceExpiry, 30000);

  // Start HTTP server
  const server = http.createServer(app);
  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`🛡️  Focus Shield API running on http://127.0.0.1:${API_PORT}`);
    console.log(`   Shield active: ${shieldActive}`);
    console.log(`   Blocked domains: ${blocked.length}`);
    console.log(`   Delayed domains: ${getDelayedDomains().length}`);
  });
}

start().catch(console.error);
