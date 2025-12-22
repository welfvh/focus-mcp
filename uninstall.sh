#!/bin/bash
# cc-focus uninstaller

echo "=== cc-focus uninstaller ==="

# Stop and remove server
echo "Removing server..."
launchctl unload ~/Library/LaunchAgents/com.welf.ccfocus.server.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.welf.ccfocus.server.plist
echo "✓ Server removed"

# Stop and remove daemon (requires sudo)
echo "Removing daemon (requires sudo)..."
sudo launchctl unload /Library/LaunchDaemons/com.welf.focusshield.daemon.plist 2>/dev/null || true
sudo rm -f /Library/LaunchDaemons/com.welf.focusshield.daemon.plist
echo "✓ Daemon removed"

# Clean hosts file
echo "Cleaning /etc/hosts..."
sudo sed -i '' '/# BEGIN FOCUS SHIELD/,/# END FOCUS SHIELD/d' /etc/hosts
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder 2>/dev/null || true
echo "✓ Hosts cleaned"

echo ""
echo "=== Uninstall complete ==="
echo "Config remains at: ~/.config/cc-focus/"
