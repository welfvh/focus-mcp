#!/bin/bash
# cc-focus installer — sets up daemon and server to run at boot.
# Generates plists from templates, detects node path, builds from source,
# and optionally configures block categories.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_PLIST_NAME="com.ccfocus.server"
DAEMON_PLIST_NAME="com.focusshield.daemon"
CONFIG_DIR="$HOME/.config/cc-focus"

echo "=== cc-focus installer ==="
echo ""

# --- 1. Check Node.js ---
NODE_PATH="$(which node 2>/dev/null || true)"
if [ -z "$NODE_PATH" ]; then
    echo "ERROR: Node.js not found. Install Node.js 18+ first."
    echo "  brew install node"
    exit 1
fi

NODE_VERSION="$($NODE_PATH --version | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "ERROR: Node.js 18+ required (found v$($NODE_PATH --version))"
    exit 1
fi
NODE_DIR="$(dirname "$NODE_PATH")"
echo "Node.js: $NODE_PATH (v$($NODE_PATH --version | sed 's/v//'))"

# --- 2. Install dependencies ---
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent 2>&1

# --- 3. Build ---
echo "Building TypeScript..."
npx tsc 2>&1
echo "Build complete."

# --- 4. Config directory ---
mkdir -p "$CONFIG_DIR"

# --- 5. MCP token ---
TOKEN_FILE="$CONFIG_DIR/mcp-token"
if [ ! -f "$TOKEN_FILE" ]; then
    uuidgen | tr '[:upper:]' '[:lower:]' > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "Generated MCP token: $TOKEN_FILE"
else
    echo "MCP token exists: $TOKEN_FILE"
fi
MCP_TOKEN="$(cat "$TOKEN_FILE")"

# --- 6. Block categories ---
if [ ! -f "$CONFIG_DIR/config.json" ]; then
    if [ "$1" = "--all" ]; then
        CATEGORIES="social,video,news,shopping,adult,gambling"
    elif [ -n "$1" ]; then
        CATEGORIES="$1"
    else
        echo ""
        echo "Available block categories:"
        echo "  social   - Twitter/X, Facebook, Instagram, TikTok, Reddit, LinkedIn, etc."
        echo "  video    - YouTube, Netflix, Twitch"
        echo "  news     - Substack"
        echo "  shopping - Amazon, eBay, Kleinanzeigen"
        echo "  adult    - Pornographic sites (50+ domains)"
        echo "  gambling - Betting sites"
        echo ""
        echo "Default: social,video,news,adult"
        read -p "Categories to enable (comma-separated, or press Enter for default): " CATEGORIES
        if [ -z "$CATEGORIES" ]; then
            CATEGORIES="social,video,news,adult"
        fi
    fi
    echo "Enabled categories: $CATEGORIES"
    # The server will initialize config.json with these categories on first run.
    # Write a minimal config so the categories are picked up.
    IFS=',' read -ra CATS <<< "$CATEGORIES"
    CAT_JSON=$(printf '"%s",' "${CATS[@]}" | sed 's/,$//')
    cat > "$CONFIG_DIR/config.json" << EOF
{
  "enabledCategories": [$CAT_JSON]
}
EOF
else
    echo "Config exists: $CONFIG_DIR/config.json (preserving)"
fi

# --- 7. Generate plists from templates ---
echo ""
echo "Generating service plists..."

# Server plist (user agent)
sed -e "s|__NODE_PATH__|$NODE_PATH|g" \
    -e "s|__INSTALL_DIR__|$SCRIPT_DIR|g" \
    -e "s|__HOME_DIR__|$HOME|g" \
    -e "s|__NODE_DIR__|$NODE_DIR|g" \
    "$SCRIPT_DIR/com.ccfocus.server.plist.template" \
    > "$SCRIPT_DIR/$SERVER_PLIST_NAME.plist"

# Daemon plist (root)
sed -e "s|__NODE_PATH__|$NODE_PATH|g" \
    -e "s|__INSTALL_DIR__|$SCRIPT_DIR|g" \
    "$SCRIPT_DIR/daemon/com.focusshield.daemon.plist.template" \
    > "$SCRIPT_DIR/daemon/$DAEMON_PLIST_NAME.plist"

# --- 8. Install daemon (requires sudo) ---
echo ""
echo "Installing daemon (requires sudo)..."
sudo cp "$SCRIPT_DIR/daemon/$DAEMON_PLIST_NAME.plist" /Library/LaunchDaemons/
sudo chown root:wheel "/Library/LaunchDaemons/$DAEMON_PLIST_NAME.plist"
sudo launchctl bootout system "/Library/LaunchDaemons/$DAEMON_PLIST_NAME.plist" 2>/dev/null || true
sudo launchctl bootstrap system "/Library/LaunchDaemons/$DAEMON_PLIST_NAME.plist"
echo "Daemon installed."

# --- 9. Install server (user agent) ---
echo "Installing server..."
cp "$SCRIPT_DIR/$SERVER_PLIST_NAME.plist" ~/Library/LaunchAgents/
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/$SERVER_PLIST_NAME.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/$SERVER_PLIST_NAME.plist
echo "Server installed."

# --- 10. Verify ---
echo ""
echo "Waiting for server..."
sleep 3
if curl -s localhost:8053/status | grep -q "running"; then
    echo ""
    echo "=== Installation complete ==="
    echo ""
    echo "API:       http://localhost:8053"
    echo "Logs:      $CONFIG_DIR/server.log"
    echo "           /var/log/cc-focus-daemon.log (sudo)"
    echo ""
    echo "--- Claude Web Connection ---"
    echo "To connect Claude Web, set up a Cloudflare Tunnel or use locally."
    echo "MCP Token: $MCP_TOKEN"
    echo ""
    echo "--- Claude Code Connection ---"
    echo "claude mcp add --transport http --scope user \\"
    echo "  --header \"Authorization: Bearer $MCP_TOKEN\" \\"
    echo "  cc-focus http://localhost:8053/mcp"
    echo ""
    echo "--- Optional: pf firewall (IP-level blocking) ---"
    echo "sudo $SCRIPT_DIR/enable-pf.sh"
else
    echo ""
    echo "WARNING: Server not responding. Check logs:"
    echo "  tail -f $CONFIG_DIR/server.log"
fi
