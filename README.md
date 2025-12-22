# cc-focus

DNS-level distraction blocker for macOS. Blocks distracting sites via `/etc/hosts` with a simple HTTP API.

## How it Works

1. A **daemon** (runs as root) manages `/etc/hosts` entries
2. A **server** provides an HTTP API on `localhost:8053`
3. Blocked domains resolve to `0.0.0.0` - browser can't connect
4. Temporary allowances can be granted via API

## Quick Start

```bash
# Clone and install
git clone https://github.com/welfvh/cc-focus.git
cd cc-focus
npm install

# Install services (auto-start on boot)
./install.sh

# Verify
curl localhost:8053/status
```

## API

```bash
# Status
curl localhost:8053/status

# List blocked domains
curl localhost:8053/api/blocked

# Add domain to blocklist
curl -X POST localhost:8053/api/block \
  -H "Content-Type: application/json" \
  -d '{"domain": "youtube.com"}'

# Remove domain
curl -X DELETE localhost:8053/api/block/youtube.com

# Grant temporary access (minutes)
curl -X POST localhost:8053/api/grant \
  -H "Content-Type: application/json" \
  -d '{"domain": "youtube.com", "minutes": 30, "reason": "work research"}'

# Revoke access
curl -X DELETE localhost:8053/api/grant/youtube.com

# Enable/disable shield
curl -X POST localhost:8053/api/shield/enable
curl -X POST localhost:8053/api/shield/disable
```

### Delay Mode (Friction)

For sites you want to use mindfully (not block entirely):

```bash
# Add to delay list
curl -X POST localhost:8053/api/delay \
  -H "Content-Type: application/json" \
  -d '{"domain": "gmail.com"}'

# Progressive delays: 10s → 20s → 40s → 80s → 160s (resets daily)
```

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
│  └────────────────────┬────────────────────┘       │
│                       │                             │
│                       │ HTTP API                    │
│                       ▼                             │
│  ┌─────────────────────────────────────────┐       │
│  │  Server (user)                          │       │
│  │  localhost:8053                         │       │
│  └─────────────────────────────────────────┘       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Default Blocked Sites

Social media, video streaming, news aggregators, adult content. See `src/store.ts` for full list.

## Configuration

- **Server config**: `~/.config/cc-focus/config.json`
- **Daemon state**: `/Library/Application Support/FocusShield/state.json`
- **Server logs**: `~/.config/cc-focus/server.log`
- **Daemon logs**: `/var/log/cc-focus-daemon.log`

## Manual Start (Development)

```bash
# Terminal 1: Daemon
sudo node daemon/daemon.js

# Terminal 2: Server
npm start
```

## Uninstall

```bash
./uninstall.sh
```

## Requirements

- macOS (uses launchd, /etc/hosts)
- Node.js 18+

## License

MIT
