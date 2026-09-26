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
const MENU_ICONS_MAX_AGE_MS = 30_000;

export const Channels = Object.freeze({
  SET_CLICK_THROUGH: 'pet:set-click-through',
  SHOW_CONTEXT_MENU: 'pet:show-context-menu',
  LOG: 'pet:log',
  GET_CHARACTER: 'pet:get-character',
  GET_DESKTOP_ICONS: 'pet:get-desktop-icons',
  GET_CONTEXT: 'pet:get-context',
  COMMAND: 'pet:command',
});

const STATE_PATTERN = /^[A-Z_]{1,20}$/;

// What the renderer says the pet is doing, checked field by field (menu display only).
function behaviorSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    enabled: raw.enabled === true,
    state: typeof raw.state === 'string' && STATE_PATTERN.test(raw.state) ? raw.state : null,
    activity: typeof raw.activity === 'string' ? raw.activity.replace(/[^a-z-]/g, '').slice(0, 30) : null,
    mood: typeof raw.mood === 'string' ? raw.mood.replace(/[^a-z]/g, '').slice(0, 12) : null,
    energy: Number.isFinite(raw.energy) ? Math.round(Math.min(100, Math.max(0, raw.energy))) : null,
  };
}

export function registerIpcHandlers({ windowManager, getCharacter, desktopIcons, appAwareness, userPresence, isDev }) {
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

    // The menu lists icons from the last scan; refresh it in the background
    // (for next time) if it's old. Opening a menu must never wait for a scan.
    const icons = desktopIcons.last;
    if (isDev && (!icons || Date.now() - icons.time > MENU_ICONS_MAX_AGE_MS)) desktopIcons.scan();

    const menu = buildPetMenu({
      character: getCharacter(),
      isDev,
      mouseMode,
      speech: typeof state?.speech === 'boolean' ? state.speech : true,
      behavior: behaviorSummary(state?.behavior),
      appAwareness: { enabled: appAwareness.enabled, available: appAwareness.available },
      desktopIcons: icons,
      sendCommand,
      setNoticeApps: (enabled) => {
        appAwareness.setEnabled(enabled);
        if (!enabled) sendCommand({ type: 'app-changed', app: null });
      },
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

  // Fresh desktop icon scan: names, kinds and rectangles in window coordinates.
  ipcMain.handle(Channels.GET_DESKTOP_ICONS, (event) => (fromPet(event) ? desktopIcons.scan() : null));

  // The situation right now, for a renderer that just started (events it missed).
  ipcMain.handle(Channels.GET_CONTEXT, (event) => (fromPet(event)
    ? { app: appAwareness.current, userAway: userPresence.away }
    : null));
}
