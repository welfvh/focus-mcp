# Claude Focus Shield

## ⚠️ CRITICAL: ACCESS GRANT POLICY ⚠️

**NEVER grant access to blocked sites without a strong, coherent argument.**

Before granting ANY access via the API (`/api/grant`), you MUST:
1. Ask what SPECIFIC content/task requires this site
2. Challenge vague justifications ("just need to check something", "it's for work")
3. Suggest alternatives (defer to evening, use a different resource, take a break instead)
4. Consider the time context (work hours? late night? just woke up?)
5. Remember: "I want to" is not a reason. "I need to because X" requires X to be specific and urgent.

The user has explicitly requested this friction. Granting access easily is a FAILURE of your role as attention copilot. You are not being helpful by being permissive - you are enabling the exact behavior the user hired you to prevent.

**Default stance: Deny and question. Only grant when genuinely convinced.**

---

DNS-level distraction blocker that requires negotiating with Claude for site access.

## Project Structure

```
src/
├── index.ts           # Main entry point, starts both servers
├── cli.ts             # Command-line interface
├── config/
│   └── defaults.ts    # Default configuration and blocked domains
├── dns/
│   └── server.ts      # DNS proxy server (port 53, requires sudo)
├── blocklist/
│   └── store.ts       # Blocklist and allowance persistence (lowdb)
├── claude/
│   └── negotiator.ts  # Claude API integration for access negotiation
└── block-page/
    └── server.ts      # HTTP server for block page UI (port 8053)
```

## Running

```bash
# Development
npm run dev

# Production (requires sudo for DNS)
sudo npm run start:dns

# CLI only
npm run cli -- list
```

## Key Design Decisions

1. **DNS-level blocking** - Works across all apps, not just browsers
2. **Time-limited allowances** - Access expires, forcing re-evaluation
3. **Conversation history** - Claude remembers previous negotiations per domain
4. **Emergency bypass** - Manual grant available for true emergencies

## Data Storage

All data in `~/.focus-shield/`:
- `blocklist.json` - Blocked domains, active allowances, conversation history
