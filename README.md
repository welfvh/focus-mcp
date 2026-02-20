# cc-focus

Multi-layer macOS distraction blocker. Blocks distracting sites via DNS (`/etc/hosts`), IP-level firewall (`pf`), MITM proxy, connection killing, and browser tab closing.

## How it Works

1. A **daemon** (runs as root) manages `/etc/hosts` entries, pf firewall rules, and kills connections
2. A **server** (runs as user) provides an HTTP API on `localhost:8053` and an MCP endpoint for Claude
3. A **proxy** (optional) intercepts HTTPS for path-level blocking and progressive delay friction
4. Blocked domains resolve to `0.0.0.0` — browser can't connect
5. Temporary allowances can be granted via API with auto-expiry

## Prerequisites

- macOS 13+ (Ventura or later)
- Node.js 18+
- `sudo` access (for daemon and `/etc/hosts`)

## Install

```bash
git clone https://github.com/welfvh/focus-mcp.git cc-focus
cd cc-focus
./install.sh
```

The installer will:
1. Check Node.js version
2. Install npm dependencies and build TypeScript
3. Generate an MCP auth token
4. Ask which block categories to enable
5. Generate and install LaunchDaemon (root) + LaunchAgent (user)
6. Verify the server is running

### Block Categories

During install, choose which categories to block:

| Category | Domains | Default |
|----------|---------|---------|
| `social` | Twitter/X, Facebook, Instagram, TikTok, Reddit, LinkedIn, Discord, etc. | ON |
| `video` | YouTube, Netflix, Twitch | ON |
| `news` | Substack | ON |
| `shopping` | Amazon, eBay, Kleinanzeigen | OFF |
| `adult` | 50+ pornographic sites | ON |
| `gambling` | Betting and casino sites | OFF |

Skip the prompt with `./install.sh --all` (all categories) or `./install.sh "social,video,adult"`.

### Optional: IP-Level Firewall

For an additional blocking layer (bypasses DNS-over-HTTPS):

```bash
sudo ./enable-pf.sh
```

This blocks IP ranges for Twitter/X, Meta, TikTok, and Netflix at the packet filter level.

### Optional: HTTPS Proxy (Path Blocking + Delays)

For path-level blocking and delay friction:

1. Trust the CA cert:
   ```bash
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain \
     ~/.config/cc-focus/certs/ca.crt
   ```
2. Set system proxy: System Settings > Network > Wi-Fi > Details > Proxies
   - HTTP Proxy: `127.0.0.1:8080`
   - HTTPS Proxy: `127.0.0.1:8080`

## Connect to Claude

### Claude Code

```bash
claude mcp add --transport http --scope user \
  --header "Authorization: Bearer $(cat ~/.config/cc-focus/mcp-token)" \
  cc-focus http://localhost:8053/mcp
```

### Claude Web

1. Set up a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) pointing to `localhost:8053`
2. In Claude Web: Settings > Connectors > Add MCP > `https://your-tunnel.example.com/mcp?token=YOUR_TOKEN`

Your MCP token is in `~/.config/cc-focus/mcp-token`.

## API

```bash
# Status
curl localhost:8053/status

# List blocked domains
curl localhost:8053/api/blocked

# Block a domain
curl -X POST localhost:8053/api/block \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com"}'

# Unblock a domain
curl -X DELETE localhost:8053/api/block/example.com

# Grant temporary access (auto-expires)
curl -X POST localhost:8053/api/grant \
  -H "Content-Type: application/json" \
  -d '{"domain": "reddit.com", "minutes": 10, "reason": "checking r/swift"}'

# Revoke access immediately
curl -X DELETE localhost:8053/api/grant/reddit.com

# List active allowances
curl localhost:8053/api/allowances

# Enable/disable shield
curl -X POST localhost:8053/api/shield/enable
curl -X POST localhost:8053/api/shield/disable

# Hard lockouts (admin-level domain locks with expiry)
curl localhost:8053/api/locks
curl -X POST localhost:8053/api/lock \
  -H "Content-Type: application/json" \
  -d '{"domain": "twitter.com", "until": "2026-03-01"}'
curl -X DELETE localhost:8053/api/lock/twitter.com
```

### Delay Mode

For sites you want to access mindfully (not block entirely):

```bash
curl -X POST localhost:8053/api/delay \
  -H "Content-Type: application/json" \
  -d '{"domain": "gmail.com"}'
```

Progressive delays: 10s → 20s → 40s → 80s → 160s per access (resets daily). After waiting through the delay, you get a 15-minute session.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Your Mac                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Browser ──► /etc/hosts ──► 0.0.0.0 (blocked)      │
│                   │                                 │
│                   │ managed by                      │
│                   ▼                                 │
│  ┌─────────────────────────────────────────┐       │
│  │  Daemon (root)                          │       │
│  │  /tmp/focusshield.sock                  │       │
│  │  - /etc/hosts management                │       │
│  │  - pf firewall rules                   │       │
│  │  - Connection killing (pfctl -k)       │       │
│  │  - Browser tab closing (AppleScript)   │       │
│  └────────────────────┬────────────────────┘       │
│                       │                             │
│                       │ IPC (Unix socket)           │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐       │
│  │  Server (user)                          │       │
│  │  localhost:8053                         │       │
│  │  - REST API + MCP endpoint              │       │
│  │  - Config management (config.json)      │       │
│  │  - Allowance auto-expiry                │       │
│  └─────────────────────────────────────────┘       │
│                                                     │
│  ┌─────────────────────────────────────────┐       │
│  │  Proxy (optional)                       │       │
│  │  localhost:8080                         │       │
│  │  - MITM HTTPS (path-level blocking)    │       │
│  │  - Delay friction pages                │       │
│  └─────────────────────────────────────────┘       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Configuration

| File | Purpose |
|------|---------|
| `~/.config/cc-focus/config.json` | Blocked domains, delayed domains, allowances, hard lockouts |
| `~/.config/cc-focus/mcp-token` | Auth token for MCP endpoint |
| `~/.config/cc-focus/server.log` | Server logs |
| `~/.config/cc-focus/certs/` | MITM proxy CA certificate (auto-generated) |
| `/Library/Application Support/FocusShield/state.json` | Daemon state |
| `/var/log/cc-focus-daemon.log` | Daemon logs |

## Troubleshooting

### Site still accessible after blocking
1. Flush DNS: `curl -X POST localhost:8053/api/flush-dns`
2. Quit browser completely (Cmd+Q) and reopen
3. Check if browser uses DNS-over-HTTPS (DoH) — disable it
4. Verify hosts: `grep -i domain /etc/hosts`
5. Enable pf for IP-level blocking: `sudo ./enable-pf.sh`

### Daemon not running
```bash
sudo launchctl list | grep focusshield
sudo launchctl kickstart system/com.focusshield.daemon
# Or check logs:
sudo tail -f /var/log/cc-focus-daemon.log
```

### Server not running
```bash
launchctl list | grep ccfocus
launchctl kickstart gui/$(id -u)/com.ccfocus.server
# Or check logs:
tail -f ~/.config/cc-focus/server.log
```

### Manual start (development)
```bash
# Terminal 1: Daemon
sudo node daemon/daemon.cjs

# Terminal 2: Server
npm start
```

## Uninstall

```bash
./uninstall.sh
```

Removes services, hosts entries, and pf rules. Config is preserved by default (prompts).

## License

Personal use only. See [LICENSE](LICENSE).
