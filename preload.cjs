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
};

contextBridge.exposeInMainWorld('desktopPet', {
  setClickThrough: (enabled) => ipcRenderer.send(Channels.SET_CLICK_THROUGH, enabled === true),
  showContextMenu: () => ipcRenderer.send(Channels.SHOW_CONTEXT_MENU),
  log: (level, message) => ipcRenderer.send(Channels.LOG, level, String(message)),
});
