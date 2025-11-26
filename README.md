# 🛡️ Claude Focus Shield

DNS-level distraction blocker powered by Claude. The only way to access blocked sites is to argue your case with Claude.

Part of the **welf vision**: Claude as AI OS UI/UX.

## How it Works

1. Focus Shield runs a local DNS server that intercepts queries
2. Blocked domains (YouTube, Twitter, Reddit, etc.) resolve to localhost
3. A block page appears where you must negotiate with Claude for access
4. Claude evaluates your reason and grants time-limited access (or not)

## Quick Start

```bash
# Install dependencies
npm install

# Start Focus Shield (requires sudo for DNS on port 53)
sudo npm run start:dns

# In another terminal, configure your DNS
./scripts/setup-dns.sh enable
```

## CLI Usage

```bash
# List blocked domains
npx focus-shield list

# Add a domain to blocklist
npx focus-shield block example.com

# Remove a domain
npx focus-shield unblock example.com

# Request access via CLI (interactive)
npx focus-shield access youtube.com

# Check active allowances
npx focus-shield status

# Emergency manual grant (bypass Claude)
npx focus-shield grant youtube.com 15
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Your Browser   │────▶│  DNS Server      │
│                 │     │  (port 53)       │
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              Blocked?                   Not blocked
                    │                         │
                    ▼                         ▼
         ┌──────────────────┐      ┌──────────────────┐
         │  Block Page      │      │  Upstream DNS    │
         │  (port 8053)     │      │  (8.8.8.8)       │
         └────────┬─────────┘      └──────────────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  Claude API      │
         │  (negotiation)   │
         └──────────────────┘
```

## Configuration

Default blocked domains are defined in `src/config/defaults.ts`. Data is stored in `~/.focus-shield/`.

### Environment Variables

- `ANTHROPIC_API_KEY` - Your Claude API key (required)
- `FOCUS_SHIELD_DATA` - Data directory (default: `~/.focus-shield`)
- `FOCUS_SHIELD_INTERFACE` - Network interface (default: `Wi-Fi`)

## The Philosophy

This isn't about willpower. It's about creating **friction** between impulse and action.

When you try to visit YouTube out of habit, you're forced to articulate *why*. Often, just being asked is enough to realize you don't actually need it. And when you do have a legitimate reason, Claude grants access.

The goal: make Claude your AI ally in the fight against distraction.

## Roadmap

- [ ] Menu bar app for macOS
- [ ] Browser extension for HTTPS handling
- [ ] Focus session modes (deep work, breaks, etc.)
- [ ] Analytics on blocked attempts and patterns
- [ ] Integration with calendar for automatic modes
- [ ] Welf integration for deeper self-reflection

## License

MIT
