// Main-process side of the renderer <-> main bridge.
//
// Every handler treats its arguments as untrusted: check the sender is our pet
// window, check the types, and ignore anything unexpected. Channel names must
// match preload.cjs (the sandboxed preload cannot import shared modules).

import { app, ipcMain, Menu } from 'electron';
import { createLogger, isLogLevel } from './logger.js';

const log = createLogger('ipc');
const rendererLog = createLogger('renderer');
const MAX_LOG_LENGTH = 1000;

export const Channels = Object.freeze({
  SET_CLICK_THROUGH: 'pet:set-click-through',
  SHOW_CONTEXT_MENU: 'pet:show-context-menu',
  LOG: 'pet:log',
});

export function registerIpcHandlers(windowManager) {
  const fromPet = (event) => {
    if (windowManager.isPetWebContents(event.sender)) return true;
    log.warn('Ignored IPC from unknown sender');
    return false;
  };

  ipcMain.on(Channels.SET_CLICK_THROUGH, (event, enabled) => {
    if (!fromPet(event) || typeof enabled !== 'boolean') return;
    windowManager.setClickThrough(enabled);
  });

  // Phase 1 menu: just enough to quit. Grows into the full pet menu later.
  ipcMain.on(Channels.SHOW_CONTEXT_MENU, (event) => {
    if (!fromPet(event)) return;
    const menu = Menu.buildFromTemplate([
      { label: 'Desktop Pet', enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    menu.popup({ window: windowManager.petWindow });
  });

  ipcMain.on(Channels.LOG, (event, level, message) => {
    if (!fromPet(event) || !isLogLevel(level) || typeof message !== 'string') return;
    rendererLog[level](message.slice(0, MAX_LOG_LENGTH));
  });
}
