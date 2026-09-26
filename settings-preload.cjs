// Preload for the settings window: the only bridge between that page and the
// main process. Exposes window.petSettings with four functions; the page never
// sees ipcRenderer or Node.js. (Sandboxed preloads must be CommonJS.)

const { contextBridge, ipcRenderer } = require('electron');

// Keep in sync with SettingsChannels in src/main/ipcHandlers.js.
const Channels = {
  LOAD: 'settings:load',
  SET: 'settings:set',
  RESET: 'settings:reset',
  CHANGED: 'settings:changed',
};

contextBridge.exposeInMainWorld('petSettings', {
  // { schema: [...], values: {...} }
  load: () => ipcRenderer.invoke(Channels.LOAD),
  // Resolves { ok, values } or { ok: false, error }.
  set: (key, value) => ipcRenderer.invoke(Channels.SET, String(key), value),
  reset: () => ipcRenderer.invoke(Channels.RESET),
  // Called with the new values when settings change anywhere (e.g. the pet menu).
  onChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, values) => callback(values);
    ipcRenderer.on(Channels.CHANGED, listener);
    return () => ipcRenderer.removeListener(Channels.CHANGED, listener);
  },
});
