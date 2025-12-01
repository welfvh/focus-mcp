#!/bin/bash
# Configure macOS system proxy to use Focus Shield proxy server

PROXY_HOST="127.0.0.1"
PROXY_PORT="8080"

# Get the active network service (usually Wi-Fi or Ethernet)
NETWORK_SERVICE=$(networksetup -listnetworkserviceorder | grep -B1 "Device:" | grep -v "Device:" | head -1 | sed 's/^.* //')

echo "🔀 Configuring proxy for: $NETWORK_SERVICE"

# Enable HTTP proxy
networksetup -setwebproxy "$NETWORK_SERVICE" "$PROXY_HOST" "$PROXY_PORT"
networksetup -setwebproxystate "$NETWORK_SERVICE" on

# Enable HTTPS proxy
networksetup -setsecurewebproxy "$NETWORK_SERVICE" "$PROXY_HOST" "$PROXY_PORT"
networksetup -setsecurewebproxystate "$NETWORK_SERVICE" on

echo "✅ Proxy configured!"
echo ""
echo "HTTP Proxy:  $PROXY_HOST:$PROXY_PORT"
echo "HTTPS Proxy: $PROXY_HOST:$PROXY_PORT"
echo ""
echo "To disable:"
echo "  networksetup -setwebproxystate '$NETWORK_SERVICE' off"
echo "  networksetup -setsecurewebproxystate '$NETWORK_SERVICE' off"
