/**
 * Focus Shield - Main Process
 *
 * Menu bar app that blocks distracting sites.
 * Uses /etc/hosts for blocking (requires one-time sudo via GUI prompt).
 * Exposes HTTP API on localhost for Claude app integration.
 */

import { app, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import { startApiServer, stopApiServer } from './api';
import { store, getBlockedDomains, getActiveAllowances, addBlockedDomain } from './store';
import { updateHostsFileWithSudo, hasHostsEntries, clearHostsEntries } from './blocker';

let tray: Tray | null = null;
let shieldActive = false;

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Hide dock icon (menu bar app only)
app.dock?.hide();

app.whenReady().then(async () => {
  createTray();

  // Start HTTP API server (for Claude app communication)
  await startApiServer();

  // Check if shield was active
  shieldActive = await hasHostsEntries();
  updateTrayMenu();
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
      label: shieldActive ? 'Disable Shield' : 'Enable Shield',
      click: async () => {
        if (shieldActive) {
          const success = await clearHostsEntries();
          if (success) shieldActive = false;
        } else {
          const success = await updateHostsFileWithSudo(blocked);
          if (success) shieldActive = true;
        }
        updateTrayMenu();
      },
    },
    {
      label: 'Refresh Blocklist',
      click: async () => {
        if (shieldActive) {
          await updateHostsFileWithSudo(blocked);
        }
        updateTrayMenu();
      },
    },
    {
      label: 'Add Block from Clipboard',
      click: async () => {
        const { clipboard } = await import('electron');
        const domain = clipboard.readText().trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

        if (!domain || !domain.includes('.') || domain.includes(' ')) {
          await dialog.showMessageBox({
            type: 'warning',
            title: 'Invalid Domain',
            message: 'Copy a valid domain to clipboard first (e.g., example.com)',
          });
          return;
        }

        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Add Block',
          message: `Block "${domain}"?`,
          buttons: ['Cancel', 'Block'],
          defaultId: 1,
        });

        if (response === 1) {
          addBlockedDomain(domain);
          if (shieldActive) {
            await updateHostsFileWithSudo(getBlockedDomains());
          }
          updateTrayMenu();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Blocked Sites (${blocked.length})`,
      submenu: blocked.slice(0, 20).map(domain => ({
        label: domain,
        enabled: false,
      })),
    },
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
      label: 'API: localhost:8053',
      click: () => {
        shell.openExternal('http://localhost:8053/status');
      },
    },
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
    { type: 'separator' },
    {
      label: 'Quit Focus Shield',
      click: () => {
        stopApiServer();
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
