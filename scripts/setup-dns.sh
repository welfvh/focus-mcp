#!/bin/bash
# Setup and teardown scripts for Focus Shield DNS configuration.
# Run with 'enable' or 'disable' argument.

set -e

INTERFACE="${FOCUS_SHIELD_INTERFACE:-Wi-Fi}"

enable_dns() {
  echo "🛡️  Enabling Focus Shield DNS..."
  sudo networksetup -setdnsservers "$INTERFACE" 127.0.0.1
  sudo dscacheutil -flushcache
  sudo killall -HUP mDNSResponder 2>/dev/null || true
  echo "✓ DNS configured to use Focus Shield"
  echo "  Interface: $INTERFACE"
  echo "  DNS: 127.0.0.1"
}

disable_dns() {
  echo "🔓 Disabling Focus Shield DNS..."
  sudo networksetup -setdnsservers "$INTERFACE" empty
  sudo dscacheutil -flushcache
  sudo killall -HUP mDNSResponder 2>/dev/null || true
  echo "✓ DNS restored to default (DHCP)"
}

show_status() {
  echo "📊 Current DNS configuration:"
  networksetup -getdnsservers "$INTERFACE"
}

case "$1" in
  enable|on)
    enable_dns
    ;;
  disable|off)
    disable_dns
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {enable|disable|status}"
    echo ""
    echo "  enable  - Set DNS to Focus Shield (127.0.0.1)"
    echo "  disable - Restore DNS to default"
    echo "  status  - Show current DNS settings"
    echo ""
    echo "Environment variables:"
    echo "  FOCUS_SHIELD_INTERFACE - Network interface (default: Wi-Fi)"
    exit 1
    ;;
esac
