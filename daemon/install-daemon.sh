#!/bin/bash
# Install Focus Shield privileged helper daemon
# Run once with: sudo bash install-daemon.sh

set -e

DAEMON_DIR="/Library/Application Support/FocusShield"
PLIST_PATH="/Library/LaunchDaemons/com.welf.focusshield.daemon.plist"

echo "Installing Focus Shield daemon..."

# Create daemon directory
mkdir -p "$DAEMON_DIR"

# Copy daemon script
cat > "$DAEMON_DIR/daemon.js" << 'DAEMON_SCRIPT'
/**
 * Focus Shield Privileged Daemon
 * Runs as root, listens on unix socket for commands from the app.
 * Handles hosts file and pf modifications without needing password prompts.
 */

const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SOCKET_PATH = '/tmp/focusshield.sock';
const HOSTS_PATH = '/etc/hosts';
const PF_ANCHOR_PATH = '/etc/pf.anchors/com.welf.focusshield';
const MARKER_START = '# BEGIN FOCUS SHIELD BLOCK';
const MARKER_END = '# END FOCUS SHIELD BLOCK';

// Clean up old socket
try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function updateHostsFile(entries) {
  let content = fs.readFileSync(HOSTS_PATH, 'utf8');

  // Remove existing block
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length);
  }
  content = content.trimEnd() + '\n';

  // Add new entries if provided
  if (entries && entries.length > 0) {
    content += '\n' + MARKER_START + '\n';
    content += `# Generated: ${new Date().toISOString()}\n`;
    content += entries.join('\n') + '\n';
    content += MARKER_END + '\n';
  }

  fs.writeFileSync(HOSTS_PATH, content);
  log(`Hosts file updated (${entries ? entries.length : 0} entries)`);
}

function updatePfRules(rules) {
  // Write anchor file
  fs.writeFileSync(PF_ANCHOR_PATH, rules || '# No rules\n');

  // Ensure anchor is in pf.conf
  let pfConf = fs.readFileSync('/etc/pf.conf', 'utf8');
  if (!pfConf.includes('com.welf.focusshield')) {
    pfConf += '\nanchor "com.welf.focusshield"\nload anchor "com.welf.focusshield" from "/etc/pf.anchors/com.welf.focusshield"\n';
    fs.writeFileSync('/etc/pf.conf', pfConf);
  }

  // Reload pf
  try {
    execSync('/sbin/pfctl -f /etc/pf.conf 2>&1', { encoding: 'utf8' });
    log('pf rules reloaded');
  } catch (e) {
    log('pf reload error: ' + e.message);
  }
}

function flushDnsCache() {
  try {
    execSync('dscacheutil -flushcache', { encoding: 'utf8' });
    execSync('killall -HUP mDNSResponder', { encoding: 'utf8' });
    log('DNS cache flushed');
  } catch (e) {
    log('DNS flush error: ' + e.message);
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};

      if (req.url === '/hosts' && req.method === 'POST') {
        updateHostsFile(data.entries);
        flushDnsCache();
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/pf' && req.method === 'POST') {
        updatePfRules(data.rules);
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/clear' && req.method === 'POST') {
        updateHostsFile([]);
        updatePfRules('# Cleared\n');
        flushDnsCache();
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/status') {
        res.end(JSON.stringify({ running: true, pid: process.pid }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o666); // Allow non-root to connect
  log(`Daemon listening on ${SOCKET_PATH}`);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
  process.exit(0);
});
DAEMON_SCRIPT

# Create LaunchDaemon plist
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.welf.focusshield.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Library/Application Support/FocusShield/daemon.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/focusshield.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/focusshield.log</string>
</dict>
</plist>
PLIST

# Set permissions
chmod 644 "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"

# Load daemon
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "✅ Daemon installed and running!"
echo "Check status: curl --unix-socket /tmp/focusshield.sock http://localhost/status"
