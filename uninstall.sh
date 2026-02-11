#!/bin/bash
# cc-focus uninstaller — removes services, hosts entries, and pf rules.

echo "=== cc-focus uninstaller ==="

# Stop and remove server
echo "Removing server..."
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.ccfocus.server.plist 2>/dev/null || true
# Also try old plist name for backwards compatibility
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.welf.ccfocus.server.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.ccfocus.server.plist
rm -f ~/Library/LaunchAgents/com.welf.ccfocus.server.plist
echo "Server removed."

# Stop and remove daemon (requires sudo)
echo "Removing daemon (requires sudo)..."
sudo launchctl bootout system /Library/LaunchDaemons/com.focusshield.daemon.plist 2>/dev/null || true
sudo launchctl bootout system /Library/LaunchDaemons/com.welf.focusshield.daemon.plist 2>/dev/null || true
sudo rm -f /Library/LaunchDaemons/com.focusshield.daemon.plist
sudo rm -f /Library/LaunchDaemons/com.welf.focusshield.daemon.plist
echo "Daemon removed."

# Clean hosts file
echo "Cleaning /etc/hosts..."
sudo sed -i '' '/# BEGIN FOCUS SHIELD/,/# END FOCUS SHIELD/d' /etc/hosts
echo "Hosts cleaned."

# Clean pf rules
echo "Cleaning pf rules..."
sudo rm -f /etc/pf.anchors/com.welf.focusshield
# Remove anchor lines from pf.conf
if grep -q "com.welf.focusshield" /etc/pf.conf 2>/dev/null; then
    sudo sed -i '' '/com\.welf\.focusshield/d' /etc/pf.conf
    sudo sed -i '' '/# cc-focus blocking anchor/d' /etc/pf.conf
    sudo pfctl -f /etc/pf.conf 2>/dev/null || true
    echo "pf rules removed."
else
    echo "No pf rules found."
fi

# Flush DNS
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder 2>/dev/null || true
echo "DNS cache flushed."

# Config
echo ""
read -p "Remove config (~/.config/cc-focus)? [y/N] " REMOVE_CONFIG
if [ "$REMOVE_CONFIG" = "y" ] || [ "$REMOVE_CONFIG" = "Y" ]; then
    rm -rf ~/.config/cc-focus
    echo "Config removed."
else
    echo "Config preserved at: ~/.config/cc-focus/"
fi

echo ""
echo "=== Uninstall complete ==="
