#!/usr/bin/env node
/**
 * Focus Shield Privileged Helper Daemon
 *
 * Runs as root via launchd, listens on a Unix socket for commands from
 * the main app. This eliminates the need for repeated password prompts.
 *
 * Commands:
 *   enable <rules-file>  - Copy rules file to anchor, reload pf
 *   disable              - Clear anchor, reload pf
 *   status               - Check if pf is enabled and anchor has rules
 */

const net = require('net');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SOCKET_PATH = '/var/run/focusshield.sock';
const ANCHOR_NAME = 'com.welf.focusshield';
const ANCHOR_FILE = `/etc/pf.anchors/${ANCHOR_NAME}`;
const PF_CONF = '/etc/pf.conf';

// Ensure we're running as root
if (process.getuid() !== 0) {
  console.error('ERROR: This daemon must run as root');
  process.exit(1);
}

/**
 * Ensure our anchor is in pf.conf
 */
function ensureAnchorInPfConf() {
  const pfConf = fs.readFileSync(PF_CONF, 'utf8');

  if (pfConf.includes(ANCHOR_NAME)) {
    return true;
  }

  // Backup and add anchor
  fs.copyFileSync(PF_CONF, `${PF_CONF}.backup`);
  const addition = `\nanchor "${ANCHOR_NAME}"\nload anchor "${ANCHOR_NAME}" from "${ANCHOR_FILE}"\n`;
  fs.appendFileSync(PF_CONF, addition);

  console.log('Added anchor to pf.conf');
  return true;
}

/**
 * Flush DNS cache
 */
function flushDns() {
  try {
    execSync('dscacheutil -flushcache', { stdio: 'ignore' });
    execSync('killall -HUP mDNSResponder 2>/dev/null || true', { stdio: 'ignore' });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Enable blocking with rules from specified file
 */
function enableBlocking(rulesFile) {
  try {
    // Ensure anchor is configured
    ensureAnchorInPfConf();

    // Copy rules to anchor file
    if (fs.existsSync(rulesFile)) {
      fs.copyFileSync(rulesFile, ANCHOR_FILE);
    } else {
      return { success: false, error: 'Rules file not found' };
    }

    // Enable and reload pf
    try {
      execSync('/sbin/pfctl -e 2>/dev/null || true', { stdio: 'ignore' });
    } catch (e) {
      // pf might already be enabled
    }
    execSync(`/sbin/pfctl -f ${PF_CONF}`, { stdio: 'ignore' });

    // Flush DNS
    flushDns();

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Disable blocking
 */
function disableBlocking() {
  try {
    // Write empty rules
    fs.writeFileSync(ANCHOR_FILE, '# Focus Shield disabled\n');

    // Reload pf
    execSync(`/sbin/pfctl -f ${PF_CONF}`, { stdio: 'ignore' });

    // Flush DNS
    flushDns();

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get status
 */
function getStatus() {
  try {
    const pfInfo = execSync('/sbin/pfctl -s info 2>&1', { encoding: 'utf8' });
    const pfEnabled = pfInfo.includes('Status: Enabled');

    let hasRules = false;
    if (fs.existsSync(ANCHOR_FILE)) {
      const rules = fs.readFileSync(ANCHOR_FILE, 'utf8');
      hasRules = rules.includes('block');
    }

    return { success: true, pfEnabled, hasRules };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Handle incoming command
 */
function handleCommand(data) {
  const parts = data.toString().trim().split(' ');
  const cmd = parts[0];
  const arg = parts.slice(1).join(' ');

  console.log(`Received command: ${cmd} ${arg}`);

  switch (cmd) {
    case 'enable':
      return enableBlocking(arg);
    case 'disable':
      return disableBlocking();
    case 'status':
      return getStatus();
    default:
      return { success: false, error: `Unknown command: ${cmd}` };
  }
}

// Clean up old socket
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// Create server
const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    const result = handleCommand(data);
    socket.write(JSON.stringify(result) + '\n');
    socket.end();
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

server.listen(SOCKET_PATH, () => {
  // Make socket accessible by non-root users
  fs.chmodSync(SOCKET_PATH, 0o666);
  console.log(`Focus Shield helper daemon listening on ${SOCKET_PATH}`);
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close();
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  server.close();
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});
