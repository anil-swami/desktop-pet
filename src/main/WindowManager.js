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
//
// Which area to cover is decided by DisplayManager; this class just applies it.

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { createLogger } from './logger.js';
import { rectText } from './DisplayManager.js';

const log = createLogger('window');
const appRoot = path.resolve(import.meta.dirname, '..', '..');

export class WindowManager {
  #window = null;
  #clickThrough = null; // null = not applied to the current window yet

  get petWindow() {
    return this.#window && !this.#window.isDestroyed() ? this.#window : null;
  }

  // bounds: the work area to cover, in DIPs.
  createPetWindow({ bounds, devTools = false }) {
    const { x, y, width, height } = bounds;
    log.info(`Creating pet window: ${rectText(bounds)}`);

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

  // Resize/move the window to cover a new work area (display changed). The
  // page gets a normal `resize` event and the pet re-fits itself.
  fitTo(bounds) {
    const win = this.petWindow;
    if (!win) return;
    const target = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    win.setBounds(target);

    // Around scaling changes Windows can adjust a window's size on its own;
    // make sure we ended up where we asked, and retry once if not.
    const actual = win.getBounds();
    if (['x', 'y', 'width', 'height'].some((key) => actual[key] !== target[key])) {
      log.warn(`Window landed at ${rectText(actual)} instead of ${rectText(target)}; retrying`);
      win.setBounds(target);
    }
    log.info(`Pet window fitted to ${rectText(target)}`);
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
