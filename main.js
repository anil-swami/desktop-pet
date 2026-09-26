// Electron entry point (the "main process").
//
// The main process is a Node.js program: it creates windows, talks to the OS,
// and owns the app lifecycle. Each window's page runs in a separate
// "renderer process" (Chromium). They talk via IPC through preload.cjs.

import { app, powerMonitor, screen } from 'electron';
import path from 'node:path';
import { createLogger, logLevel } from './src/main/logger.js';
import { WindowManager } from './src/main/WindowManager.js';
import { DisplayManager, describeDisplay } from './src/main/DisplayManager.js';
import { Channels, SettingsChannels, registerIpcHandlers } from './src/main/ipcHandlers.js';
import { listCharacters, loadCharacter } from './src/main/CharacterLoader.js';
import { WindowsHelper } from './src/main/WindowsHelper.js';
import { DesktopIcons } from './src/main/DesktopIcons.js';
import { AppAwareness } from './src/main/AppAwareness.js';
import { UserPresence } from './src/main/UserPresence.js';
import { SettingsStore } from './src/main/SettingsStore.js';
import { SettingsWindow } from './src/main/SettingsWindow.js';

const log = createLogger('main');
const isDev = process.argv.includes('--dev');

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
  // Read-only Windows shell queries (desktop icons, foreground app). Starts on first use.
  // process.pid is passed so the helper ignores the pet's own window.
  const windowsHelper = new WindowsHelper({ petPid: process.pid, log: createLogger('helper') });
  const desktopIcons = new DesktopIcons({
    helper: windowsHelper,
    toDipRect: (rect) => (process.platform === 'win32' ? screen.screenToDipRect(null, rect) : rect),
    getWorkArea: () => displayManager.current.workArea,
    log: createLogger('desktop'),
  });

  // Push events to the pet page (if it's there).
  const sendToPet = (command) => {
    const contents = windowManager.petWindow?.webContents;
    if (contents && !contents.isLoading()) contents.send(Channels.COMMAND, command);
  };
  const appAwareness = new AppAwareness({
    helper: windowsHelper,
    onChange: (app) => sendToPet({ type: 'app-changed', app }),
    log: createLogger('apps'),
  });
  const userPresence = new UserPresence({
    powerMonitor,
    onChange: (away) => sendToPet({ type: 'user-away', away }),
    log: createLogger('presence'),
  });

  const settingsWindow = new SettingsWindow();
  let settings = null;
  let character = null;

  // Settings the main process applies itself; everything else goes to the pet page.
  function onSettingsChanged({ changed, values }) {
    if ('alwaysOnTop' in changed) windowManager.setAlwaysOnTop(values.alwaysOnTop);
    if ('noticeApps' in changed) {
      appAwareness.setEnabled(values.noticeApps);
      if (!values.noticeApps) sendToPet({ type: 'app-changed', app: null });
    }
    settingsWindow.send(SettingsChannels.CHANGED, values);
    if ('character' in changed || 'scale' in changed) {
      if ('character' in changed) character = loadCharacterSafely(values.character) ?? character;
      windowManager.reloadPet(); // the page starts over with the new look
      return;
    }
    sendToPet({ type: 'settings', settings: values });
  }

  app.whenReady().then(() => {
    log.info(`Starting Desktop Pet ${app.getVersion()} (Electron ${process.versions.electron}, log level: ${logLevel})`);
    settings = new SettingsStore({
      file: path.join(app.getPath('userData'), 'settings.json'),
      getCharacters: () => listCharacters(),
      log: createLogger('settings'),
    });
    settings.load();
    settings.onChange(onSettingsChanged);
    character = loadCharacterSafely(settings.get('character')) ?? loadCharacterSafely('default');

    registerIpcHandlers({
      windowManager, settingsWindow, settings, getCharacter: () => character,
      desktopIcons, appAwareness, userPresence, isDev,
    });
    userPresence.start();
    appAwareness.setEnabled(settings.get('noticeApps'));

    // Keep the pet window fitted to the screen's work area as it changes.
    const display = displayManager.start((next) => windowManager.fitTo(next.workArea));
    log.info(describeDisplay(display));
    windowManager.createPetWindow({ bounds: display.workArea, devTools: isDev, alwaysOnTop: settings.get('alwaysOnTop') });

    // Developer convenience: `npm run dev -- --open-settings` opens the settings window at start.
    if (process.argv.includes('--open-settings')) settingsWindow.open({ title: `${character?.name ?? 'Pet'} settings` });
  });

  app.on('second-instance', () => log.info('Second launch attempt ignored'));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    settings?.flush();
    displayManager.stop();
    userPresence.stop();
    appAwareness.stop();
    windowsHelper.stop();
    log.info('Shutting down');
  });
}
