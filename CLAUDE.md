# cc-focus - Claude Code Setup Guide

When a user wants to set up cc-focus, follow this interactive workflow.

## Step 1: Ask About Block Categories

Use AskUserQuestion to prompt the user about which categories to block:

```
Which categories do you want to block?
```

**Categories:**

| Category | Examples | Default |
|----------|----------|---------|
| Social Media | Twitter/X, Facebook, Instagram, TikTok, LinkedIn, Reddit, Threads, Bluesky | ON |
| Video Streaming | YouTube, Netflix, Twitch, Disney+ | ON |
| News/Aggregators | Hacker News, Lobsters, Substack | ON |
| Shopping | Amazon, eBay, Kleinanzeigen | OFF |
| Adult Content | Pornhub, OnlyFans, etc. (75k+ domains) | ON |
| Gambling | Sports betting, casinos | OFF |

Let the user select multiple. Default is Social + Video + News + Adult.

## Step 2: Ask About Delay Sites

```
Any sites you want delayed (not blocked)?
```

Delay = progressive friction (10s → 20s → 40s → 80s → 160s per day).
Good for: email (gmail.com), productivity tools you sometimes need.

Default delayed: gmail.com, mail.google.com

## Step 3: Run Installation

After gathering preferences, run:

```bash
cd ~/dev/cc-focus
npm install
./install.sh  # This requires sudo - warn user
```

The install script will:
1. Install the daemon (runs as root, manages /etc/hosts)
2. Install the server (runs as user, provides API on localhost:8053)
3. Both auto-start on boot

## Step 4: Enable pf Firewall

```bash
sudo ~/dev/cc-focus/enable-pf.sh
```

This adds IP-level blocking for Twitter/X, Meta, TikTok, Netflix.

## Step 5: Configure Browser (if using delays/path blocking)

For delay friction and path blocking, the user needs to:
1. Trust the CA cert: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.config/cc-focus/certs/ca.crt`
2. Set system proxy: System Settings → Network → Wi-Fi → Details → Proxies → HTTP & HTTPS to 127.0.0.1:8080

Skip this step if user only wants DNS blocking.

## Step 6: Verify

```bash
curl localhost:8053/status
curl localhost:8053/api/check/twitter.com
```

## Customizing Block Lists

After setup, modify `~/.config/cc-focus/config.json` or use the API:

```bash
# Add domain
curl -X POST localhost:8053/api/block -H "Content-Type: application/json" -d '{"domain": "example.com"}'

# Remove domain
curl -X DELETE localhost:8053/api/block/example.com

# Add to delay list
curl -X POST localhost:8053/api/delay -H "Content-Type: application/json" -d '{"domain": "gmail.com"}'
```

## Unblock Protocol

IMPORTANT: When user asks to unblock a site, DO NOT just comply. Follow this:

1. Ask WHY they need access
2. Challenge if it's truly necessary
3. Ask for specific duration (5, 10, 15, 30 min)
4. Use auto-expiring grant:

```bash
curl -X POST localhost:8053/api/grant -H "Content-Type: application/json" \
  -d '{"domain": "twitter.com", "minutes": 10, "reason": "checking DMs"}'
```

Max 30 minutes without strong justification.

## Troubleshooting

### Site still accessible after blocking
1. Flush DNS: `curl -X POST localhost:8053/api/flush-dns`
2. Quit browser completely (Cmd+Q) and reopen
3. Check if browser uses DoH (DNS over HTTPS) - disable it
4. Verify in hosts: `grep -i domain /etc/hosts`

### Daemon not running
```bash
sudo launchctl list | grep focusshield
sudo launchctl start com.welf.focusshield.daemon
```

### Server not running
```bash
launchctl list | grep ccfocus
launchctl start com.welf.ccfocus.server
```
