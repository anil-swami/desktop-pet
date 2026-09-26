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
  COMMAND: 'pet:command',
};

contextBridge.exposeInMainWorld('desktopPet', {
  setClickThrough: (enabled) => ipcRenderer.send(Channels.SET_CLICK_THROUGH, enabled === true),
  // `state` lets the menu show current settings (e.g. the mouse mode).
  // Only known fields are copied, as plain strings.
  showContextMenu: (state) => ipcRenderer.send(Channels.SHOW_CONTEXT_MENU, {
    mouseMode: typeof state?.mouseMode === 'string' ? state.mouseMode : null,
  }),
  log: (level, message) => ipcRenderer.send(Channels.LOG, level, String(message)),

  // Request/response: resolves with the validated character data (or null).
  getCharacter: () => ipcRenderer.invoke(Channels.GET_CHARACTER),

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
