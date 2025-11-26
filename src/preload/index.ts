/**
 * Preload script for Focus Shield.
 * Minimal since this is primarily a menu bar app.
 */

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('focusShield', {
  version: '0.1.0',
});
