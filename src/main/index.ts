/**
 * Focus Shield - Main Process
 *
 * Restrictive menu bar app that blocks distracting sites.
 * Uses /etc/hosts for blocking (requires one-time sudo via GUI prompt).
 * Exposes HTTP API on localhost for Claude app integration.
 *
 * No dashboard UI - all unblocking requires talking to Claude.
 */

import { app, Tray, Menu, nativeImage, shell, dialog, clipboard } from 'electron';
import { startApiServer, stopApiServer } from './api';
import { startProxyServer, stopProxyServer } from './proxy';
import { store, getBlockedDomains, getActiveAllowances, addBlockedDomain } from './store';
import { updateHostsFileWithSudo, clearHostsEntries, pfPulseKill } from './blocker';
import { generateClaudeContext } from './attention-copilot';

let tray: Tray | null = null;
let shieldActive = false;
let allowanceCheckInterval: NodeJS.Timeout | null = null;
let lastAllowanceCount = 0;

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Hide dock icon - menu bar only
app.dock?.hide();

/**
 * Check for expired allowances and re-block if needed.
 * Runs every 30 seconds to catch expiring allowances.
 */
async function checkAllowanceExpiry(): Promise<void> {
  if (!shieldActive) return;

  const currentAllowances = getActiveAllowances();
  const currentCount = currentAllowances.length;

  // If allowance count decreased, an allowance expired - refresh blocking
  if (currentCount < lastAllowanceCount) {
    console.log(`Allowance expired (${lastAllowanceCount} -> ${currentCount}), refreshing blocks...`);
    const domains = getBlockedDomains();
    await updateHostsFileWithSudo(domains);

    // Pulse pf to kill existing browser connections
    await pfPulseKill(domains);

    updateTrayMenu();
  }

  lastAllowanceCount = currentCount;
}

app.whenReady().then(async () => {
  createTray();

  // Start HTTP API server (for Claude app communication)
  await startApiServer();

  // Start HTTP Proxy server (for delay interception)
  await startProxyServer();

  // Enable shield by default on startup
  const blocked = getBlockedDomains();
  const success = await updateHostsFileWithSudo(blocked);
  shieldActive = success;
  lastAllowanceCount = getActiveAllowances().length;
  updateTrayMenu();

  // Start allowance expiry checker (every 30 seconds)
  allowanceCheckInterval = setInterval(checkAllowanceExpiry, 30000);
});

function createTray() {
  // Create a minimal 16x16 transparent PNG with a small dot
  // This is needed because Electron Tray requires a non-empty image
  // The actual visibility comes from setTitle() with emoji
  const transparentPng = Buffer.from(
    // 16x16 transparent PNG (minimal valid PNG)
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWjAAcAAAJAAAGBVhBJAAAAAElFTkSuQmCC',
    'base64'
  );

  const icon = nativeImage.createFromBuffer(transparentPng, {
    width: 16,
    height: 16,
    scaleFactor: 1.0,
  });

  tray = new Tray(icon);
  tray.setToolTip('Focus Shield - Distraction Blocker');

  // Use text title in menu bar (this is what shows)
  tray.setTitle('🛡️');

  updateTrayMenu();
}

export function updateTrayMenu() {
  const blocked = getBlockedDomains();
  const allowances = getActiveAllowances();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: shieldActive ? '🟢 Shield Active' : '🔴 Shield Inactive',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '🤖 Talk to Claude (Unblock)',
      click: async () => {
        const context = generateClaudeContext();
        const prompt = `${context}

---

**I want to access a blocked site.** You are my attention copilot - challenge me on whether this is genuinely necessary.

Before granting access, consider:
- What specific content/task requires this site?
- Is this the right time? (work hours? late night?)
- Can this be deferred to later?
- Are there alternative resources?

Remember: "I want to" is not a reason. "I need to because X" requires X to be specific and urgent.

To grant access, use:
curl -X POST http://localhost:8053/api/grant -H "Content-Type: application/json" -d '{"domain":"example.com","minutes":15,"reason":"your reasoning"}'`;

        clipboard.writeText(prompt);

        await dialog.showMessageBox({
          type: 'info',
          title: 'Talk to Claude',
          message: 'Context copied to clipboard!',
          detail: 'Open Claude Code and paste to negotiate access. Claude will challenge you before granting.',
          buttons: ['OK'],
          defaultId: 0,
        });
      },
    },
    { type: 'separator' },
    {
      label: `Active Passes (${allowances.length})`,
      submenu: allowances.length > 0
        ? allowances.map(a => ({
            label: `${a.domain} - ${Math.ceil((a.expiresAt - Date.now()) / 60000)}m left`,
            enabled: false,
          }))
        : [{ label: 'None', enabled: false }],
    },
    { type: 'separator' },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: store.get('startAtLogin', false),
      click: (menuItem) => {
        store.set('startAtLogin', menuItem.checked);
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
        });
      },
    },
    {
      label: 'Quit Focus Shield',
      click: () => {
        if (allowanceCheckInterval) clearInterval(allowanceCheckInterval);
        stopApiServer();
        stopProxyServer();
        app.quit();
      },
    },
  ]);

  tray?.setContextMenu(contextMenu);
}

// Export shieldActive state for API
export function isShieldActive(): boolean {
  return shieldActive;
}

export function setShieldActive(active: boolean): void {
  shieldActive = active;
}

app.on('window-all-closed', (e: Event) => {
  e.preventDefault(); // Keep running as menu bar app
});
