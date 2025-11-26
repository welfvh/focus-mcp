#!/bin/bash
# Install Focus Shield as a launchd service (macOS).
# This allows Focus Shield to start automatically on boot.

set -e

PLIST_NAME="com.welf.focus-shield"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
INSTALL_DIR="$HOME/.focus-shield"
LOG_DIR="$INSTALL_DIR/logs"

echo "🛡️  Installing Focus Shield as launchd service..."

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"

# Get the path to the built CLI
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_PATH="$SCRIPT_DIR/dist/index.js"

if [ ! -f "$CLI_PATH" ]; then
  echo "❌ Error: dist/index.js not found. Run 'npm run build' first."
  exit 1
fi

# Create the plist file
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${CLI_PATH}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>ANTHROPIC_API_KEY</key>
        <string>${ANTHROPIC_API_KEY}</string>
    </dict>
</dict>
</plist>
EOF

echo "✓ Created plist at $PLIST_PATH"

# Note: The DNS server requires root, so this will need adjustment
# For now, this sets up the block page server only
echo ""
echo "⚠️  Note: The DNS server requires root privileges."
echo "   For full functionality, you'll need to run separately with sudo."
echo ""
echo "To load the service:"
echo "  launchctl load $PLIST_PATH"
echo ""
echo "To unload:"
echo "  launchctl unload $PLIST_PATH"
echo ""
echo "To check status:"
echo "  launchctl list | grep focus-shield"
