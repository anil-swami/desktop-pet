// Preload script: the ONLY bridge between the page and the main process.
//
// It runs before the page loads, in an isolated world with access to a small
// set of Electron APIs. contextBridge copies a minimal, explicit API onto
// `window.desktopPet` for the page to use. The page never sees ipcRenderer
// or any Node.js API.
//
// Why .cjs? Sandboxed preloads must be CommonJS, while the rest of the
// project uses ES modules ("type": "module" in package.json).

const { contextBridge, ipcRenderer } = require('electron');

// Keep in sync with Channels in src/main/ipcHandlers.js.
const Channels = {
  SET_CLICK_THROUGH: 'pet:set-click-through',
  SHOW_CONTEXT_MENU: 'pet:show-context-menu',
  LOG: 'pet:log',
  GET_CHARACTER: 'pet:get-character',
  GET_DESKTOP_ICONS: 'pet:get-desktop-icons',
  GET_CONTEXT: 'pet:get-context',
  COMMAND: 'pet:command',
};

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
const number = (value) => (Number.isFinite(value) ? value : null);

contextBridge.exposeInMainWorld('desktopPet', {
  setClickThrough: (enabled) => ipcRenderer.send(Channels.SET_CLICK_THROUGH, enabled === true),
  // `state` lets the menu show current settings (mouse mode, what the pet is doing).
  // Only known fields are copied, as plain values.
  showContextMenu: (state) => ipcRenderer.send(Channels.SHOW_CONTEXT_MENU, {
    mouseMode: text(state?.mouseMode, 20),
    speech: typeof state?.speech === 'boolean' ? state.speech : null,
    behavior: state?.behavior ? {
      enabled: state.behavior.enabled === true,
      state: text(state.behavior.state, 20),
      activity: text(state.behavior.activity, 30),
      mood: text(state.behavior.mood, 12),
      energy: number(state.behavior.energy),
    } : null,
  }),
  log: (level, message) => ipcRenderer.send(Channels.LOG, level, String(message)),

  // Request/response: resolves with the validated character data (or null).
  getCharacter: () => ipcRenderer.invoke(Channels.GET_CHARACTER),

  // Request/response: desktop icon names, kinds and rectangles (no file paths).
  getDesktopIcons: () => ipcRenderer.invoke(Channels.GET_DESKTOP_ICONS),

  // Request/response: the app in front and whether the user is away, right now.
  getContext: () => ipcRenderer.invoke(Channels.GET_CONTEXT),

  // Subscribe to commands pushed by the main process. Returns an unsubscribe
  // function. Only the command object is passed on, never the IPC event
  // (which would give the page a handle to the sender).
  onCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on(Channels.COMMAND, listener);
    return () => ipcRenderer.removeListener(Channels.COMMAND, listener);
  },
});
