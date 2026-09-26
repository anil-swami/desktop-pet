// Main-process side of the renderer <-> main bridge.
//
// Two IPC styles are used:
//   ipcMain.on(...)     fire-and-forget messages from the page (send)
//   ipcMain.handle(...) request/response: the page awaits a return value (invoke)
// and one in the other direction:
//   webContents.send(COMMAND, ...)  main pushes a command to the page
//
// Every handler treats its arguments as untrusted: check the sender is our pet
// window, check the types, and ignore anything unexpected. Channel names must
// match preload.cjs (the sandboxed preload cannot import shared modules).

import { ipcMain } from 'electron';
import { createLogger, isLogLevel } from './logger.js';
import { buildPetMenu, MOUSE_MODE_ITEMS } from './contextMenu.js';

const log = createLogger('ipc');
const rendererLog = createLogger('renderer');
const MAX_LOG_LENGTH = 1000;

export const Channels = Object.freeze({
  SET_CLICK_THROUGH: 'pet:set-click-through',
  SHOW_CONTEXT_MENU: 'pet:show-context-menu',
  LOG: 'pet:log',
  GET_CHARACTER: 'pet:get-character',
  COMMAND: 'pet:command',
});

export function registerIpcHandlers({ windowManager, getCharacter, isDev }) {
  const fromPet = (event) => {
    if (windowManager.isPetWebContents(event.sender)) return true;
    log.warn('Ignored IPC from unknown sender');
    return false;
  };

  ipcMain.on(Channels.SET_CLICK_THROUGH, (event, enabled) => {
    if (!fromPet(event) || typeof enabled !== 'boolean') return;
    windowManager.setClickThrough(enabled);
  });

  ipcMain.on(Channels.SHOW_CONTEXT_MENU, (event, state) => {
    if (!fromPet(event)) return;
    const sendCommand = (command) => {
      if (!event.sender.isDestroyed()) event.sender.send(Channels.COMMAND, command);
    };
    const mouseMode = MOUSE_MODE_ITEMS.some(([, mode]) => mode === state?.mouseMode) ? state.mouseMode : null;
    const menu = buildPetMenu({
      character: getCharacter(),
      isDev,
      mouseMode,
      sendCommand,
      openDevTools: () => windowManager.openDevTools(),
    });
    menu.popup({ window: windowManager.petWindow });
  });

  ipcMain.on(Channels.LOG, (event, level, message) => {
    if (!fromPet(event) || !isLogLevel(level) || typeof message !== 'string') return;
    rendererLog[level](message.slice(0, MAX_LOG_LENGTH));
  });

  // Returns the validated character data (or null if none could be loaded).
  ipcMain.handle(Channels.GET_CHARACTER, (event) => (fromPet(event) ? getCharacter() : null));
}
