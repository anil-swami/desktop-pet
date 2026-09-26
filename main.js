// Electron entry point (the "main process").
//
// The main process is a Node.js program: it creates windows, talks to the OS,
// and owns the app lifecycle. Each window's page runs in a separate
// "renderer process" (Chromium). They talk via IPC through preload.cjs.

import { app } from 'electron';
import { createLogger, logLevel } from './src/main/logger.js';
import { WindowManager } from './src/main/WindowManager.js';
import { registerIpcHandlers } from './src/main/ipcHandlers.js';

const log = createLogger('main');
const isDev = process.argv.includes('--dev');

// Only one pet at a time: a second launch exits immediately.
if (!app.requestSingleInstanceLock()) {
  log.info('Another instance is already running; exiting');
  app.quit();
} else {
  const windowManager = new WindowManager();

  app.whenReady().then(() => {
    log.info(`Starting Desktop Pet ${app.getVersion()} (Electron ${process.versions.electron}, log level: ${logLevel})`);
    registerIpcHandlers(windowManager);
    windowManager.createPetWindow({ devTools: isDev });
  });

  app.on('second-instance', () => log.info('Second launch attempt ignored'));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => log.info('Shutting down'));
}
