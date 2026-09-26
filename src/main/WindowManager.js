// Owns the pet's BrowserWindow.
//
// Design: ONE transparent, frameless, click-through window that covers the
// primary display's *work area* (the screen minus the taskbar). The pet is a
// DOM element inside it. Moving the pet later = changing a CSS transform, not
// moving an OS window every frame.
//
// Click-through: by default the window ignores the mouse, so clicks fall
// through to whatever is underneath. The renderer tells us when the cursor is
// over the pet and we temporarily accept mouse input (see setClickThrough).

import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('window');
const appRoot = path.resolve(import.meta.dirname, '..', '..');

export class WindowManager {
  #window = null;
  #clickThrough = null; // null = not applied to the current window yet

  get petWindow() {
    return this.#window && !this.#window.isDestroyed() ? this.#window : null;
  }

  createPetWindow({ devTools = false } = {}) {
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    log.info(`Primary display ${display.id}: work area ${width}x${height} at (${x}, ${y}), scale ${display.scaleFactor}`);

    const win = new BrowserWindow({
      x, y, width, height,
      show: false,                  // show only once the page has painted (no white flash)
      transparent: true,            // per-pixel transparency: only the pet is visible
      backgroundColor: '#00000000', // fully transparent ARGB
      frame: false,                 // no title bar or border
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,            // a pet, not an app: no taskbar button
      alwaysOnTop: true,
      focusable: false,             // clicking the pet never steals focus from your active app
      webPreferences: {
        preload: path.join(appRoot, 'preload.cjs'),
        contextIsolation: true,     // page JS and preload JS live in separate worlds
        nodeIntegration: false,     // page JS cannot touch Node.js
        sandbox: true,              // renderer runs in Chromium's OS-level sandbox
        devTools,
      },
    });

    this.#window = win;
    this.#clickThrough = null;
    this.setClickThrough(true);
    this.#lockDownNavigation(win);

    win.once('ready-to-show', () => {
      win.showInactive(); // show without activating/focusing
      log.info('Pet window visible');
    });

    // Safety net: if the renderer dies or hangs while the window is accepting
    // the mouse, the invisible window would block the whole screen. Restore
    // click-through so the desktop stays usable.
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`Renderer gone (${details.reason}); restoring click-through`);
      this.setClickThrough(true);
    });
    win.on('unresponsive', () => {
      log.warn('Renderer unresponsive; restoring click-through');
      this.setClickThrough(true);
    });

    win.on('closed', () => {
      this.#window = null;
      log.info('Pet window closed');
    });

    win.loadFile(path.join(appRoot, 'src', 'renderer', 'index.html')).catch((err) => {
      log.error('Failed to load renderer:', err);
    });

    return win;
  }

  // enabled = true  -> clicks pass through the window to the desktop/apps below.
  // enabled = false -> the window receives mouse input (cursor is over the pet).
  // `forward: true` keeps sending mousemove events to the page while ignoring
  // clicks, which is how the renderer knows when the cursor reaches the pet.
  setClickThrough(enabled) {
    const win = this.petWindow;
    if (!win || enabled === this.#clickThrough) return;
    this.#clickThrough = enabled;
    win.setIgnoreMouseEvents(enabled, { forward: true });
    log.debug(`Click-through ${enabled ? 'ON' : 'OFF'}`);
  }

  // Only works when the window was created with devTools enabled (npm run dev).
  openDevTools() {
    this.petWindow?.webContents.openDevTools({ mode: 'detach' });
  }

  isPetWebContents(webContents) {
    return this.petWindow?.webContents === webContents;
  }

  // The pet page should never navigate away or open popups.
  #lockDownNavigation(win) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
  }
}
