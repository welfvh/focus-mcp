/**
 * MCP (Model Context Protocol) server for cc-focus.
 *
 * Exposes focus shield tools over Streamable HTTP transport so that
 * Claude Web (and any other MCP client) can manage blocking via
 * a Cloudflare Tunnel to this local server.
 *
 * Mounted on the existing Express server at /mcp.
 * Auth: Bearer token required (header or ?token= query param).
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  getBlockedDomains,
  getActiveAllowances,
  getDelayedDomains,
  isDomainBlocked,
  getAllowanceRemaining,
  grantAllowance,
  getEffectivelyBlockedDomains,
  addBlockedDomain,
  removeBlockedDomain,
  isHardLocked,
  getHardLockoutUntil,
  getActiveHardLockouts,
} from './store.js';
import {
  isDaemonRunning,
  enableBlocking,
  enforceBlockViaDaemon,
  flushDnsCache,
} from './blocker.js';

// --- Auth token management ---

const CONFIG_DIR = path.join(process.env.HOME || '/tmp', '.config', 'cc-focus');
const TOKEN_FILE = path.join(CONFIG_DIR, 'mcp-token');

function loadOrCreateToken(): string {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch {}
  const token = randomUUID();
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  console.log(`MCP auth token generated: ${TOKEN_FILE}`);
  return token;
}

const MCP_TOKEN = process.env.CC_FOCUS_MCP_TOKEN || loadOrCreateToken();

// --- Session management ---
// Each MCP client session gets its own transport instance

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

function createMcpServer(shieldActiveGetter: () => boolean): McpServer {
  const server = new McpServer(
    { name: 'cc-focus', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // --- Read-only tools ---

  server.tool(
    'focus_status',
    'Get the current state of the focus shield: whether it\'s active, daemon health, number of blocked domains, and any active time-limited allowances.',
    {},
    async () => {
      const daemonRunning = await isDaemonRunning();
      const result = {
        shieldActive: shieldActiveGetter(),
        daemonRunning,
        blockedDomains: getBlockedDomains().length,
        activeAllowances: getActiveAllowances(),
        hardLockouts: getActiveHardLockouts(),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'focus_blocked_list',
    'List all domains currently on the blocklist.',
    {},
    async () => {
      const domains = getBlockedDomains();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ count: domains.length, domains }, null, 2) }] };
    },
  );

  server.tool(
    'focus_check_domain',
    'Check whether a specific domain is currently blocked and if it has an active allowance.',
    { domain: z.string().describe('The domain to check, e.g. "twitter.com"') },
    async ({ domain }) => {
      const blocked = isDomainBlocked(domain);
      const allowanceMinutes = getAllowanceRemaining(domain);
      const locked = isHardLocked(domain);
      const result = { domain, blocked, allowanceMinutes, shieldActive: shieldActiveGetter(), locked };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'focus_allowances',
    'List all active time-limited access grants (allowances). Shows which domains have temporary access and when it expires.',
    {},
    async () => {
      const allowances = getActiveAllowances();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ allowances }, null, 2) }] };
    },
  );

  server.tool(
    'focus_delayed_list',
    'List domains with delay friction (progressive wait times instead of full block).',
    {},
    async () => {
      const domains = getDelayedDomains();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ domains }, null, 2) }] };
    },
  );

  // --- Write tools ---

  server.tool(
    'focus_grant',
    `Grant time-limited access to a blocked domain. Access auto-expires and the domain is aggressively re-blocked (DNS, connections killed, browser tabs closed).

IMPORTANT: Before calling this tool, you MUST:
1. Ask the user WHY they need access — what specific task?
2. Challenge whether it's truly necessary — is there an alternative?
3. Clarify their specific intention — "What exactly will you do in the next 10 minutes?"
4. Get a specific duration (5, 10, 15, 30 min max).

Twitter/X and YouTube are HARD LOCKED until March 2026. This tool will refuse those domains.`,
    {
      domain: z.string().describe('The domain to grant access to, e.g. "reddit.com"'),
      minutes: z.number().min(1).max(30).describe('Duration in minutes (1-30)'),
      reason: z.string().describe('Why the user needs access — be specific'),
    },
    async ({ domain, minutes, reason }) => {
      // Hard lockout check
      if (isHardLocked(domain)) {
        const until = getHardLockoutUntil(domain);
        return {
          content: [{
            type: 'text' as const,
            text: `REFUSED: ${domain} is HARD LOCKED until ${until}. No exceptions. This lockout exists because a "20 minute" session became 3+ hours on 2026-02-02. The timer approach failed. Use newsletters, RSS, or ask Claude to search instead.`,
          }],
          isError: true,
        };
      }

      const allowance = grantAllowance(domain, minutes, reason);

      if (shieldActiveGetter()) {
        await enableBlocking(getEffectivelyBlockedDomains());
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            granted: true,
            domain,
            minutes,
            reason,
            expiresAt: new Date(allowance.expiresAt).toISOString(),
            warning: 'Access will auto-expire. Connections will be killed and browser tabs closed on expiry.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'focus_block',
    'Add a domain to the blocklist. Immediately blocks DNS, kills connections, and closes browser tabs for that domain.',
    { domain: z.string().describe('The domain to block, e.g. "example.com"') },
    async ({ domain }) => {
      addBlockedDomain(domain);

      if (shieldActiveGetter()) {
        await enableBlocking(getBlockedDomains());
        await flushDnsCache();
        await enforceBlockViaDaemon(domain);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ blocked: true, domain }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'focus_unblock',
    `Permanently remove a domain from the blocklist. Use focus_grant for temporary access instead — permanent unblock should only be used for domains that are genuinely creation/work tools.

Hard-locked domains (configured via API) will be refused.`,
    { domain: z.string().describe('The domain to unblock') },
    async ({ domain }) => {
      // Hard lockout check
      if (isHardLocked(domain)) {
        const until = getHardLockoutUntil(domain);
        return {
          content: [{
            type: 'text' as const,
            text: `REFUSED: ${domain} is HARD LOCKED until ${until}. No exceptions. Not even permanent unblock.`,
          }],
          isError: true,
        };
      }

      removeBlockedDomain(domain);

      if (shieldActiveGetter()) {
        await enableBlocking(getBlockedDomains());
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ unblocked: true, domain }, null, 2),
        }],
      };
    },
  );

  return server;
}

// --- Express route mounting ---

export function mountMCP(app: Express, shieldActiveGetter: () => boolean): void {
  // Auth middleware for /mcp routes
  function authCheck(req: Request, res: Response): boolean {
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const queryToken = req.query.token as string | undefined;
    const token = headerToken || queryToken;

    if (!token || token !== MCP_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // POST /mcp — handles initialization and tool calls
  app.post('/mcp', async (req: Request, res: Response) => {
    if (!authCheck(req, res)) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to its transport
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createMcpServer(shieldActiveGetter);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);

    // Store session after connect so sessionId is available
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server });
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for server-initiated messages
  app.get('/mcp', async (req: Request, res: Response) => {
    if (!authCheck(req, res)) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // DELETE /mcp — terminate session
  app.delete('/mcp', async (req: Request, res: Response) => {
    if (!authCheck(req, res)) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
  });

  console.log(`   MCP endpoint: /mcp (auth token in ${TOKEN_FILE})`);
}
