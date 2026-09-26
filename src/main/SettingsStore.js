// Loads, validates, saves and announces the user's settings.
//
// Stored as JSON in the app's user-data folder (%APPDATA%\desktop-pet\settings.json),
// never in the repo. Every value goes through the schema (src/config/settingsSchema.js):
//   - a missing file means defaults
//   - a broken file is kept as "settings.json.corrupt-<time>" and defaults are used
//   - a bad value (e.g. edited by hand) falls back to its default
// Saving is debounced (a slider doesn't write the disk on every step) and
// atomic (write a temp file, then rename), so a crash can't leave half a file.

import nodeFs from 'node:fs';
import path from 'node:path';
import { defaultSettings, describeSettings, validateSetting, validateSettings } from '../config/settingsSchema.js';

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class SettingsStore {
  #file;
  #fs;
  #log;
  #getCharacters;
  #saveDelayMs;
  #values = defaultSettings();
  #listeners = new Set();
  #saveTimer = null;

  constructor({ file, fs = nodeFs, log = silentLog, getCharacters = () => [['default', 'Pip']], saveDelayMs = 300 }) {
    this.#file = file;
    this.#fs = fs;
    this.#log = log;
    this.#getCharacters = getCharacters;
    this.#saveDelayMs = saveDelayMs;
  }

  load() {
    let raw;
    if (this.#fs.existsSync(this.#file)) {
      try {
        raw = JSON.parse(this.#fs.readFileSync(this.#file, 'utf8').replace(/^﻿/, ''));
      } catch (err) {
        const backup = `${this.#file}.corrupt-${Date.now()}`;
        this.#log.warn(`Settings file is damaged (${err.message}); keeping it as ${path.basename(backup)} and using defaults`);
        try { this.#fs.renameSync(this.#file, backup); } catch { /* best effort */ }
      }
    }
    const { values, problems } = validateSettings(raw, { characters: this.#getCharacters() });
    for (const problem of problems) this.#log.warn(`Settings: ${problem}`);
    this.#values = values;
    this.#log.info(raw ? `Settings loaded from ${this.#file}` : 'No saved settings yet: using defaults');
    return this.all();
  }

  get(key) {
    return this.#values[key];
  }

  all() {
    return { ...this.#values };
  }

  // The schema, with the list of characters filled in (for the settings window).
  schema() {
    return describeSettings({ characters: this.#getCharacters() });
  }

  // Change one setting. Returns { ok, values } or { ok: false, error }.
  set(key, value) {
    const result = validateSetting(key, value, { characters: this.#getCharacters() });
    if (!result.ok) {
      this.#log.warn(`Rejected setting: ${result.error}`);
      return { ok: false, error: result.error };
    }
    if (this.#values[key] !== result.value) {
      this.#values[key] = result.value;
      this.#log.info(`Setting ${key} = ${JSON.stringify(result.value)}`);
      this.#scheduleSave();
      this.#notify({ [key]: result.value });
    }
    return { ok: true, values: this.all() };
  }

  reset() {
    const defaults = defaultSettings();
    const changed = Object.fromEntries(Object.entries(defaults).filter(([key, value]) => this.#values[key] !== value));
    this.#values = defaults;
    this.#log.info('Settings reset to defaults');
    this.#scheduleSave();
    if (Object.keys(changed).length) this.#notify(changed);
    return { ok: true, values: this.all() };
  }

  // listener({ changed: { key: value }, values }). Returns an unsubscribe function.
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Write now if a save is pending (e.g. on quit).
  flush() {
    if (!this.#saveTimer) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#write();
  }

  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#write();
    }, this.#saveDelayMs);
  }

  #write() {
    const temp = `${this.#file}.tmp`;
    try {
      this.#fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      this.#fs.writeFileSync(temp, `${JSON.stringify(this.#values, null, 2)}\n`, 'utf8');
      this.#fs.renameSync(temp, this.#file);
    } catch (err) {
      this.#log.error(`Could not save settings: ${err.message}`);
    }
  }

  #notify(changed) {
    const event = { changed, values: this.all() };
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#log.error(`Settings listener failed: ${err.message}`);
      }
    }
  }
}
