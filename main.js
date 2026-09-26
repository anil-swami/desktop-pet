// Electron entry point (the "main process").
//
// The main process is a Node.js program: it creates windows, talks to the OS,
// and owns the app lifecycle. Each window's page runs in a separate
// "renderer process" (Chromium). They talk via IPC through preload.cjs.

import { app, powerMonitor, screen } from 'electron';
import { createLogger, logLevel } from './src/main/logger.js';
import { WindowManager } from './src/main/WindowManager.js';
import { DisplayManager, describeDisplay } from './src/main/DisplayManager.js';
import { registerIpcHandlers } from './src/main/ipcHandlers.js';
import { loadCharacter } from './src/main/CharacterLoader.js';

const log = createLogger('main');
const isDev = process.argv.includes('--dev');
const CHARACTER_ID = 'default'; // becomes a setting in Phase 12

// A broken character pack must not stop the app: log it and let the renderer
// show its fallback shape.
function loadCharacterSafely(id) {
  try {
    const { character, warnings } = loadCharacter(id);
    for (const warning of warnings) log.warn(`Character "${id}": ${warning}`);
    log.info(`Loaded character "${character.name}" (${Object.keys(character.animations).length} animations)`);
    return character;
  } catch (err) {
    log.error(`Failed to load character "${id}": ${err.message}`);
    return null;
  }
}

// Only one pet at a time: a second launch exits immediately.
if (!app.requestSingleInstanceLock()) {
  log.info('Another instance is already running; exiting');
  app.quit();
} else {
  const windowManager = new WindowManager();
  const displayManager = new DisplayManager({ screen, powerMonitor, log: createLogger('display') });

  app.whenReady().then(() => {
    log.info(`Starting Desktop Pet ${app.getVersion()} (Electron ${process.versions.electron}, log level: ${logLevel})`);
    const character = loadCharacterSafely(CHARACTER_ID);
    registerIpcHandlers({ windowManager, getCharacter: () => character, isDev });

    // Keep the pet window fitted to the screen's work area as it changes.
    const display = displayManager.start((next) => windowManager.fitTo(next.workArea));
    log.info(describeDisplay(display));
    windowManager.createPetWindow({ bounds: display.workArea, devTools: isDev });
  });

  app.on('second-instance', () => log.info('Second launch attempt ignored'));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    displayManager.stop();
    log.info('Shutting down');
  });
}
