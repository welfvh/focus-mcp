#!/bin/bash
# cc-focus installer - sets up daemon and server to run at boot

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_PLIST="$SCRIPT_DIR/daemon/com.welf.focusshield.daemon.plist"
SERVER_PLIST="$SCRIPT_DIR/com.welf.ccfocus.server.plist"

echo "=== cc-focus installer ==="

# Create config directory
mkdir -p ~/.config/cc-focus

# Install daemon (requires sudo)
echo "Installing daemon (requires sudo)..."
sudo cp "$DAEMON_PLIST" /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/com.welf.focusshield.daemon.plist
sudo launchctl unload /Library/LaunchDaemons/com.welf.focusshield.daemon.plist 2>/dev/null || true
sudo launchctl load /Library/LaunchDaemons/com.welf.focusshield.daemon.plist
echo "✓ Daemon installed and running"

# Install server (user agent)
echo "Installing server..."
cp "$SERVER_PLIST" ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.welf.ccfocus.server.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.welf.ccfocus.server.plist
echo "✓ Server installed and running"

# Verify
sleep 2
if curl -s localhost:8053/status | grep -q "running"; then
    echo ""
    echo "=== Installation complete ==="
    echo "API: http://localhost:8053"
    echo "Logs: ~/.config/cc-focus/server.log"
    echo "      /var/log/cc-focus-daemon.log (sudo)"
else
    echo ""
    echo "⚠️  Server not responding. Check logs:"
    echo "   tail -f ~/.config/cc-focus/server.log"
fi
