/**
 * HTTP API for Focus Shield.
 * Runs on localhost:8053 for Claude app integration.
 *
 * Claude can communicate with Focus Shield via:
 * 1. HTTP requests to this API
 * 2. Shell script: scripts/focus-shield
 *
 * Example usage from Claude:
 *   curl localhost:8053/api/block -d '{"domain":"youtube.com"}' -H "Content-Type: application/json"
 *   curl localhost:8053/api/grant -d '{"domain":"youtube.com","minutes":15,"reason":"work research"}' -H "Content-Type: application/json"
 */

import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
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
} from './store';
import { updateHostsFileWithSudo, clearHostsEntries, hasHostsEntries } from './blocker';
import { updateTrayMenu, isShieldActive, setShieldActive } from './index';

const app = express();
let server: http.Server | null = null;

const API_PORT = 8053;

app.use(express.json());

// CORS for local requests only
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * GET /status - Overall status
 */
app.get('/status', async (_req: Request, res: Response) => {
  res.json({
    app: 'Focus Shield',
    version: '0.1.0',
    shieldActive: isShieldActive(),
    blockedDomains: getBlockedDomains(),
    activeAllowances: getActiveAllowances(),
  });
});

/**
 * GET /api/blocked - List all blocked domains
 */
app.get('/api/blocked', (_req: Request, res: Response) => {
  res.json({
    domains: getBlockedDomains(),
  });
});

/**
 * POST /api/block - Add a domain to blocklist
 * Body: { domain: string }
 */
app.post('/api/block', async (req: Request, res: Response) => {
  const { domain } = req.body;
  if (!domain) {
    res.status(400).json({ error: 'domain required' });
    return;
  }
  addBlockedDomain(domain);

  // If shield is active, refresh hosts file
  if (isShieldActive()) {
    await updateHostsFileWithSudo(getBlockedDomains());
  }

  updateTrayMenu();
  res.json({ success: true, domain, blocked: true });
});

/**
 * DELETE /api/block/:domain - Remove a domain from blocklist
 */
app.delete('/api/block/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  removeBlockedDomain(domain);

  // If shield is active, refresh hosts file
  if (isShieldActive()) {
    await updateHostsFileWithSudo(getBlockedDomains());
  }

  updateTrayMenu();
  res.json({ success: true, domain, blocked: false });
});

/**
 * GET /api/check/:domain - Check if a domain is currently blocked
 */
app.get('/api/check/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  const blocked = isDomainBlocked(domain);
  const remaining = getAllowanceRemaining(domain);
  res.json({ domain, blocked, allowanceMinutes: remaining, shieldActive: isShieldActive() });
});

/**
 * POST /api/grant - Grant temporary access to a domain
 * Body: { domain: string, minutes: number, reason: string }
 *
 * This is the key endpoint for Claude integration.
 * Claude can call this after negotiating with the user.
 */
app.post('/api/grant', async (req: Request, res: Response) => {
  const { domain, minutes, reason } = req.body;

  if (!domain || !minutes) {
    res.status(400).json({ error: 'domain and minutes required' });
    return;
  }

  const allowance = grantAllowance(domain, minutes, reason || 'Granted via API');

  // If shield is active, refresh hosts file to remove this domain
  if (isShieldActive()) {
    await updateHostsFileWithSudo(getBlockedDomains());
  }

  updateTrayMenu();
  res.json({
    success: true,
    domain,
    minutes,
    expiresAt: allowance.expiresAt,
    expiresIn: `${minutes} minutes`,
  });
});

/**
 * DELETE /api/grant/:domain - Revoke an allowance
 */
app.delete('/api/grant/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  revokeAllowance(domain);

  // If shield is active, refresh hosts file to re-block this domain
  if (isShieldActive()) {
    await updateHostsFileWithSudo(getBlockedDomains());
  }

  updateTrayMenu();
  res.json({ success: true, domain, revoked: true });
});

/**
 * GET /api/allowances - List active allowances
 */
app.get('/api/allowances', (_req: Request, res: Response) => {
  const allowances = getActiveAllowances();
  res.json({
    allowances: allowances.map(a => ({
      domain: a.domain,
      minutesRemaining: Math.ceil((a.expiresAt - Date.now()) / 60000),
      reason: a.reason,
      expiresAt: new Date(a.expiresAt).toISOString(),
    })),
  });
});

/**
 * POST /api/shield/enable - Enable the shield (update hosts file)
 */
app.post('/api/shield/enable', async (_req: Request, res: Response) => {
  const success = await updateHostsFileWithSudo(getBlockedDomains());
  if (success) {
    setShieldActive(true);
    updateTrayMenu();
    res.json({ success: true, shieldActive: true });
  } else {
    res.status(500).json({ error: 'Failed to enable shield - user may have cancelled' });
  }
});

/**
 * POST /api/shield/disable - Disable the shield (clear hosts file)
 */
app.post('/api/shield/disable', async (_req: Request, res: Response) => {
  const success = await clearHostsEntries();
  if (success) {
    setShieldActive(false);
    updateTrayMenu();
    res.json({ success: true, shieldActive: false });
  } else {
    res.status(500).json({ error: 'Failed to disable shield - user may have cancelled' });
  }
});

/**
 * GET /delay - Serve delay countdown page for delayed domains
 * Query params: domain, delay (seconds), count (access count today)
 */
app.get('/delay', (req: Request, res: Response) => {
  const domain = req.query.domain as string;
  const delay = parseInt(req.query.delay as string || '10', 10);
  const count = parseInt(req.query.count as string || '0', 10);

  // Calculate next delay
  const nextDelay = Math.min(10 * Math.pow(2, count + 1), 160);

  const delayPagePath = path.join(__dirname, 'delay-page.html');

  if (fs.existsSync(delayPagePath)) {
    const html = fs.readFileSync(delayPagePath, 'utf8');
    res.send(html);
  } else {
    // Fallback if file not found
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Focus Shield - Delay</title></head>
      <body>
        <h1>Focus Shield</h1>
        <p>Delayed access to: ${domain}</p>
        <p>Wait ${delay} seconds...</p>
        <script>
          setTimeout(() => {
            window.location.href = 'https://${domain}';
          }, ${delay * 1000});
        </script>
      </body>
      </html>
    `);
  }
});

/**
 * GET /api/check-delay/:domain - Check if domain should be delayed
 * Returns delay info or pass-through status
 */
app.get('/api/check-delay/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;

  // Check if domain is delayed
  if (!isDomainDelayed(domain)) {
    res.json({ delayed: false, passThrough: true });
    return;
  }

  // Check if in active session
  if (isInActiveSession(domain)) {
    updateSessionAccess(domain); // Keep session alive
    res.json({ delayed: false, inSession: true, passThrough: true });
    return;
  }

  // Need to delay
  const delaySeconds = getDelaySeconds(domain);
  const sessions = require('./store').store.get('delaySessions', []);
  const session = sessions.find((s: any) => s.domain === domain);
  const accessCount = session?.accessCount || 0;
  const nextDelay = Math.min(10 * Math.pow(2, accessCount + 1), 160);

  res.json({
    delayed: true,
    delaySeconds,
    accessCount,
    nextDelay,
    redirectUrl: `/delay?domain=${domain}&delay=${delaySeconds}&count=${accessCount}`
  });
});

/**
 * POST /api/delay-complete - Called after delay countdown finishes
 * Records the access and grants session allowance
 */
app.post('/api/delay-complete', (req: Request, res: Response) => {
  const { domain } = req.body;

  if (!domain) {
    res.status(400).json({ error: 'domain required' });
    return;
  }

  // Record the access (increments count)
  recordDelayAccess(domain);

  res.json({ success: true, message: 'Access recorded, session started' });
});

/**
 * Start the API server.
 */
export async function startApiServer(): Promise<void> {
  return new Promise((resolve) => {
    server = app.listen(API_PORT, '127.0.0.1', () => {
      console.log(`🌐 API server running on http://127.0.0.1:${API_PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the API server.
 */
export async function stopApiServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}
