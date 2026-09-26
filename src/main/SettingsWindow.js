// The settings window: a small, normal (framed) window, opened from the pet
// menu. Only one exists at a time; opening it again just brings it forward.
// Closing it doesn't quit the app (the pet window keeps running).

import { BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('settings');
const appRoot = path.resolve(import.meta.dirname, '..', '..');

export class SettingsWindow {
  #window = null;

  get window() {
    return this.#window && !this.#window.isDestroyed() ? this.#window : null;
  }

  open({ title = 'Settings' } = {}) {
    const existing = this.window;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 480,
      height: 700,
      minWidth: 420,
      minHeight: 480,
      title,
      show: false,
      autoHideMenuBar: true,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1d21' : '#f7f5f1', // no white flash
      webPreferences: {
        preload: path.join(appRoot, 'settings-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.#window = null;
      log.info('Settings window closed');
    });
    win.loadFile(path.join(appRoot, 'src', 'settings', 'index.html')).catch((err) => log.error(`Failed to load settings: ${err.message}`));
    this.#window = win;
    log.info('Settings window opened');
  }

  isSettingsContents(webContents) {
    return this.window?.webContents === webContents;
  }

  // Tell an open settings window about changes made elsewhere (e.g. the pet menu).
  send(channel, payload) {
    this.window?.webContents.send(channel, payload);
  }

  close() {
    this.window?.close();
  }
}
