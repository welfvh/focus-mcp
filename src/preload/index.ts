/**
 * Preload script for Focus Shield.
 * Exposes safe APIs to the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('focusShield', {
  version: '0.1.0',
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});
