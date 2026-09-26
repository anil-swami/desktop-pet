// The tray icon (next to the clock): manage the pet even when it's hidden,
// paused, or out of reach. Left- or right-click for the menu.
//
// The icon turns grey while the pet is paused or hidden. Keep a reference to
// the Tray object for the app's lifetime: if it's garbage-collected, the icon
// disappears.

import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { createLogger } from './logger.js';
import { trayMenuTemplate, trayTooltip } from './trayMenu.js';

const log = createLogger('tray');
const ICON_DIR = path.resolve(import.meta.dirname, '..', '..', 'assets', 'icons');

export class TrayManager {
  #tray = null;
  #petControl;
  #settings;
  #openSettings;
  #getName;
  #listCharacters;
  #exit;
  #icons;

  constructor({ petControl, settings, openSettings, getName, listCharacters, exit }) {
    this.#petControl = petControl;
    this.#settings = settings;
    this.#openSettings = openSettings;
    this.#getName = getName;
    this.#listCharacters = listCharacters;
    this.#exit = exit;
    this.#icons = {
      normal: nativeImage.createFromPath(path.join(ICON_DIR, 'pet.ico')),
      resting: nativeImage.createFromPath(path.join(ICON_DIR, 'pet-paused.ico')),
    };
  }

  create() {
    if (this.#tray) return;
    this.#tray = new Tray(this.#icons.normal);
    // Right-click opens the menu by itself; make left-click do the same. (No double-click
    // action: Windows sends a click first, which would already have opened the menu.)
    this.#tray.on('click', () => this.#tray.popUpContextMenu());
    this.refresh();
    log.info('Tray icon ready');
  }

  // Rebuild the menu, tooltip and icon from the current state.
  refresh() {
    if (!this.#tray) return;
    const state = {
      name: this.#getName(),
      paused: this.#petControl.paused,
      hidden: this.#petControl.hidden,
    };
    const control = this.#petControl;
    const template = trayMenuTemplate({
      ...state,
      characters: this.#listCharacters(),
      currentCharacter: this.#settings.get('character'),
      actions: {
        pause: () => control.pause(),
        resume: () => control.resume(),
        hide: () => control.hide(),
        show: () => control.show(),
        openSettings: () => this.#openSettings(),
        changeCharacter: (id) => this.#settings.set('character', id),
        exit: () => this.#exit(),
      },
    });
    this.#tray.setContextMenu(Menu.buildFromTemplate(template));
    this.#tray.setToolTip(trayTooltip(state));
    this.#tray.setImage(control.resting ? this.#icons.resting : this.#icons.normal);
  }

  destroy() {
    this.#tray?.destroy();
    this.#tray = null;
  }
}
