# Claude Focus Shield

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
