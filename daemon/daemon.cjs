/**
 * Focus Shield Privileged Daemon
 * Runs as root, maintains blocking state INDEPENDENTLY of the app.
 *
 * Key principle: Default state is BLOCKED. Allowances are temporary exceptions.
 * If anything goes wrong, we block.
 */

const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SOCKET_PATH = '/tmp/focusshield.sock';
const HOSTS_PATH = '/etc/hosts';
const PF_ANCHOR_PATH = '/etc/pf.anchors/com.welf.focusshield';
const STATE_PATH = '/Library/Application Support/FocusShield/state.json';
const MARKER_START = '# BEGIN FOCUS SHIELD BLOCK';
const MARKER_END = '# END FOCUS SHIELD BLOCK';

// Daemon's own state - persisted to disk
let state = {
  blockedDomains: [],
  allowances: [], // { domain, expiresAt, reason }
  shieldActive: true,
  lastUpdated: Date.now()
};

// Clean up old socket
try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      state = { ...state, ...data };
      log(`State loaded: ${state.blockedDomains.length} domains, ${state.allowances.length} allowances`);
    }
  } catch (e) {
    log('Failed to load state: ' + e.message);
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    log('Failed to save state: ' + e.message);
  }
}

function getActiveAllowances() {
  const now = Date.now();
  return state.allowances.filter(a => a.expiresAt > now);
}

function getDomainsToBlock() {
  const active = getActiveAllowances();
  const allowedDomains = new Set(active.map(a => a.domain.toLowerCase()));
  return state.blockedDomains.filter(d => !allowedDomains.has(d.toLowerCase()));
}

function collectAllDomainsWithVariants(domains) {
  const all = new Set();
  for (const domain of domains) {
    all.add(domain);
    if (!domain.startsWith('www.')) {
      all.add('www.' + domain);
    }
    // YouTube variants
    if (domain.includes('youtube.com')) {
      ['m.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].forEach(d => all.add(d));
    }
    // Twitter/X variants (exact match only)
    if (domain === 'twitter.com' || domain === 'x.com') {
      ['mobile.twitter.com', 'mobile.x.com'].forEach(d => all.add(d));
    }
    // Reddit variants
    if (domain.includes('reddit.com')) {
      ['old.reddit.com', 'new.reddit.com', 'i.reddit.com'].forEach(d => all.add(d));
    }
  }
  return Array.from(all);
}

function updateHostsFile() {
  const domainsToBlock = getDomainsToBlock();
  const allDomains = collectAllDomainsWithVariants(domainsToBlock);

  let content = fs.readFileSync(HOSTS_PATH, 'utf8');

  // Remove existing block
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length);
  }
  content = content.trimEnd() + '\n';

  // Add new entries if shield is active
  if (state.shieldActive && allDomains.length > 0) {
    content += '\n' + MARKER_START + '\n';
    content += `# Generated: ${new Date().toISOString()}\n`;
    content += `# Blocking ${allDomains.length} domains\n`;
    for (const domain of allDomains) {
      content += `0.0.0.0 ${domain}\n`;
      content += `:: ${domain}\n`;
    }
    content += MARKER_END + '\n';
  }

  fs.writeFileSync(HOSTS_PATH, content);
  log(`Hosts updated: ${allDomains.length} domains blocked`);
}

function updatePfRules(rules) {
  fs.writeFileSync(PF_ANCHOR_PATH, rules || '# No rules\n');

  let pfConf = fs.readFileSync('/etc/pf.conf', 'utf8');
  if (!pfConf.includes('com.welf.focusshield')) {
    pfConf += '\nanchor "com.welf.focusshield"\nload anchor "com.welf.focusshield" from "/etc/pf.anchors/com.welf.focusshield"\n';
    fs.writeFileSync('/etc/pf.conf', pfConf);
  }

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

function generatePfRules() {
  // Static IP ranges for major distraction sites
  const rules = `# cc-focus pf rules - generated ${new Date().toISOString()}
# Block outgoing connections to blocked service IPs

# Twitter/X Corp (AS13414)
block drop out quick proto tcp to 104.244.42.0/24
block drop out quick proto tcp to 104.244.43.0/24
block drop out quick proto tcp to 104.244.44.0/24
block drop out quick proto tcp to 104.244.45.0/24
block drop out quick proto tcp to 104.244.46.0/24
block drop out quick proto tcp to 69.195.160.0/24
block drop out quick proto tcp to 192.133.77.0/24

# Meta/Facebook/Instagram (AS32934)
block drop out quick proto tcp to 157.240.0.0/16
block drop out quick proto tcp to 31.13.0.0/16
block drop out quick proto tcp to 179.60.192.0/22
block drop out quick proto tcp to 185.60.216.0/22
block drop out quick proto tcp to 66.220.144.0/20
block drop out quick proto tcp to 69.63.176.0/20
block drop out quick proto tcp to 69.171.224.0/19
block drop out quick proto tcp to 74.119.76.0/22
block drop out quick proto tcp to 102.132.96.0/20
block drop out quick proto tcp to 103.4.96.0/22
block drop out quick proto tcp to 129.134.0.0/16
block drop out quick proto tcp to 147.75.208.0/20
block drop out quick proto tcp to 173.252.64.0/18
block drop out quick proto tcp to 204.15.20.0/22

# TikTok (ByteDance - partial)
block drop out quick proto tcp to 161.117.0.0/16
block drop out quick proto tcp to 162.62.0.0/16

# Netflix (AS2906) - primary ranges
block drop out quick proto tcp to 23.246.0.0/18
block drop out quick proto tcp to 37.77.184.0/21
block drop out quick proto tcp to 45.57.0.0/17
block drop out quick proto tcp to 64.120.128.0/17
block drop out quick proto tcp to 66.197.128.0/17
block drop out quick proto tcp to 108.175.32.0/20
block drop out quick proto tcp to 185.2.220.0/22
block drop out quick proto tcp to 185.9.188.0/22
block drop out quick proto tcp to 192.173.64.0/18
block drop out quick proto tcp to 198.38.96.0/19
block drop out quick proto tcp to 198.45.48.0/20
block drop out quick proto tcp to 208.75.76.0/22
`;
  return rules;
}

function refreshBlocking() {
  updateHostsFile();
  flushDnsCache();
  // Enable pf blocking when shield is active
  if (state.shieldActive) {
    updatePfRules(generatePfRules());
  } else {
    updatePfRules('# cc-focus pf disabled\n');
  }
}

// Check for expired allowances every 30 seconds
let lastAllowanceCount = 0;
function checkAllowanceExpiry() {
  const active = getActiveAllowances();

  // Clean expired from state
  if (active.length !== state.allowances.length) {
    state.allowances = active;
    saveState();
  }

  // If count dropped, an allowance expired - refresh blocking
  if (active.length < lastAllowanceCount) {
    log(`Allowance expired (${lastAllowanceCount} -> ${active.length}), re-blocking...`);
    refreshBlocking();
  }

  lastAllowanceCount = active.length;
}

// Start expiry checker
setInterval(checkAllowanceExpiry, 30000);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};

      if (req.url === '/hosts' && req.method === 'POST') {
        // Legacy: direct hosts update (still supported for compatibility)
        updateHostsFile();
        flushDnsCache();
        res.end(JSON.stringify({ success: true }));

      } else if (req.url === '/pf' && req.method === 'POST') {
        updatePfRules(data.rules);
        res.end(JSON.stringify({ success: true }));

      } else if (req.url === '/blocklist' && req.method === 'POST') {
        // Update the daemon's blocklist
        state.blockedDomains = data.domains || [];
        state.lastUpdated = Date.now();
        saveState();
        refreshBlocking();
        res.end(JSON.stringify({ success: true, count: state.blockedDomains.length }));

      } else if (req.url === '/grant' && req.method === 'POST') {
        // Grant temporary allowance
        const { domain, minutes, reason } = data;
        if (!domain || !minutes) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'domain and minutes required' }));
          return;
        }

        // Remove existing allowance for this domain
        state.allowances = state.allowances.filter(a => a.domain.toLowerCase() !== domain.toLowerCase());

        const allowance = {
          domain: domain.toLowerCase(),
          expiresAt: Date.now() + minutes * 60 * 1000,
          reason: reason || 'Granted via daemon'
        };
        state.allowances.push(allowance);
        lastAllowanceCount = state.allowances.length;
        saveState();
        refreshBlocking();

        res.end(JSON.stringify({ success: true, allowance }));

      } else if (req.url === '/revoke' && req.method === 'POST') {
        // Revoke allowance
        const { domain } = data;
        state.allowances = state.allowances.filter(a => a.domain.toLowerCase() !== domain.toLowerCase());
        saveState();
        refreshBlocking();
        res.end(JSON.stringify({ success: true }));

      } else if (req.url === '/enable' && req.method === 'POST') {
        state.shieldActive = true;
        saveState();
        refreshBlocking();
        res.end(JSON.stringify({ success: true, shieldActive: true }));

      } else if (req.url === '/disable' && req.method === 'POST') {
        state.shieldActive = false;
        saveState();
        refreshBlocking();
        res.end(JSON.stringify({ success: true, shieldActive: false }));

      } else if (req.url === '/status') {
        res.end(JSON.stringify({
          running: true,
          pid: process.pid,
          shieldActive: state.shieldActive,
          blockedDomains: state.blockedDomains.length,
          activeAllowances: getActiveAllowances(),
          lastUpdated: state.lastUpdated
        }));

      } else if (req.url === '/flush-dns' && req.method === 'POST') {
        flushDnsCache();
        res.end(JSON.stringify({ success: true, message: 'DNS cache flushed' }));

      } else if (req.url === '/clear' && req.method === 'POST') {
        state.shieldActive = false;
        state.allowances = [];
        saveState();
        updateHostsFile();
        updatePfRules('# Cleared\n');
        flushDnsCache();
        res.end(JSON.stringify({ success: true }));

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

// Load state and start
loadState();
lastAllowanceCount = getActiveAllowances().length;

// Ensure blocking is active on startup
if (state.shieldActive && state.blockedDomains.length > 0) {
  log('Restoring blocking state on startup...');
  refreshBlocking();
}

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o666);
  log(`Daemon listening on ${SOCKET_PATH}`);
  log(`Shield: ${state.shieldActive ? 'ACTIVE' : 'inactive'}, Domains: ${state.blockedDomains.length}`);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
  process.exit(0);
});
