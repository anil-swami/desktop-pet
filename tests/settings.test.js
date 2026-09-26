import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS, defaultSettings, describeSettings, validateSetting, validateSettings } from '../src/config/settingsSchema.js';
import { SettingsStore } from '../src/main/SettingsStore.js';
import { listCharacters } from '../src/main/CharacterLoader.js';

const characters = [['default', 'Pip'], ['robo', 'Robo']];

describe('settings schema', () => {
  test('every setting has a valid default', () => {
    for (const definition of SETTINGS) {
      const result = validateSetting(definition.key, definition.default, { characters });
      assert.ok(result.ok, `${definition.key}: ${result.error}`);
    }
  });

  test('booleans, numbers and choices are checked', () => {
    assert.equal(validateSetting('speech', 'yes').ok, false);
    assert.equal(validateSetting('walkSpeed', '60').ok, false);
    assert.equal(validateSetting('activityLevel', 'hyper').ok, false);
    assert.deepEqual(validateSetting('activityLevel', 'lively'), { ok: true, value: 'lively' });
    assert.equal(validateSetting('nonsense', 1).ok, false);
  });

  test('numbers are clamped to their range and snapped to the step', () => {
    assert.equal(validateSetting('walkSpeed', 1000).value, 120);
    assert.equal(validateSetting('walkSpeed', 62).value, 60);
    assert.equal(validateSetting('scale', 1.2345).value, 1.2);
    assert.equal(validateSetting('scale', 0.1 + 0.2 + 0.8).value, 1.1); // no float noise
  });

  test('the character must be one that exists', () => {
    assert.equal(validateSetting('character', 'robo', { characters }).ok, true);
    assert.equal(validateSetting('character', 'ghost', { characters }).ok, false);
  });

  test('a saved object is repaired: bad values → default, unknown keys dropped', () => {
    const { values, problems } = validateSettings({ speech: false, walkSpeed: 'fast', removedSetting: 1 }, { characters });
    assert.equal(values.speech, false);
    assert.equal(values.walkSpeed, 60);
    assert.equal('removedSetting' in values, false);
    assert.equal(problems.length, 1);
  });

  test('garbage is replaced by the defaults', () => {
    assert.deepEqual(validateSettings([1, 2], { characters }).values, defaultSettings());
    assert.deepEqual(validateSettings(null, { characters }).values, defaultSettings());
  });

  test('the schema sent to the settings window lists the characters', () => {
    const character = describeSettings({ characters }).find((d) => d.key === 'character');
    assert.deepEqual(character.options, characters);
  });
});

describe('SettingsStore', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
    dirs.push(dir);
    const file = path.join(dir, 'nested', 'settings.json');
    const warnings = [];
    const log = { debug() {}, info() {}, warn: (m) => warnings.push(m), error: (m) => warnings.push(m) };
    const make = () => new SettingsStore({ file, log, getCharacters: () => characters, saveDelayMs: 5 });
    return { dir, file, warnings, make };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  test('no file yet: defaults', () => {
    const { make } = setup();
    assert.deepEqual(make().load(), defaultSettings());
  });

  test('changes are saved and come back next time', async () => {
    const { make, file } = setup();
    const store = make();
    store.load();
    assert.equal(store.set('speech', false).ok, true);
    assert.equal(store.set('walkSpeed', 80).ok, true);
    await settle();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).walkSpeed, 80);
    const again = make();
    again.load();
    assert.equal(again.get('speech'), false);
    assert.equal(again.get('walkSpeed'), 80);
    assert.equal(fs.existsSync(`${file}.tmp`), false, 'written atomically via a temp file');
  });

  test('invalid values are rejected and nothing changes', () => {
    const { make } = setup();
    const store = make();
    store.load();
    const result = store.set('activityLevel', 'hyper');
    assert.equal(result.ok, false);
    assert.equal(store.get('activityLevel'), 'normal');
  });

  test('listeners hear about real changes only', () => {
    const { make } = setup();
    const store = make();
    store.load();
    const events = [];
    store.onChange((event) => events.push(event.changed));
    store.set('speech', false);
    store.set('speech', false); // same value: no event
    store.reset();
    assert.deepEqual(events, [{ speech: false }, { speech: true }]);
  });

  test('a damaged file is kept aside and defaults are used', () => {
    const { make, file, warnings } = setup();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ "speech": fals');
    const store = make();
    assert.deepEqual(store.load(), defaultSettings());
    assert.ok(warnings.some((w) => /damaged/.test(w)));
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('settings.json.corrupt-'));
    assert.equal(backups.length, 1);
  });

  test('flush() writes a pending save immediately (e.g. on quit)', () => {
    const { file, warnings } = setup();
    const store = new SettingsStore({ file, getCharacters: () => characters, saveDelayMs: 60_000, log: { info() {}, warn: (m) => warnings.push(m), error() {} } });
    store.load();
    store.set('quality', 'saver');
    store.flush();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).quality, 'saver');
  });
});

describe('listCharacters', () => {
  test('finds the bundled character', () => {
    assert.deepEqual(listCharacters(), [['default', 'Pip']]);
  });

  test('a missing folder gives an empty list', () => {
    assert.deepEqual(listCharacters({ charactersDir: path.join(os.tmpdir(), 'no-such-characters-dir') }), []);
  });
});
