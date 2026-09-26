import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PetControl } from '../src/main/PetControl.js';
import { trayMenuTemplate, trayTooltip } from '../src/main/trayMenu.js';
import { packIco } from '../scripts/ico.mjs';

function setupControl() {
  const sent = [];
  const windowCalls = [];
  const windowManager = { hidePet: () => windowCalls.push('hide'), showPet: () => windowCalls.push('show') };
  const control = new PetControl({ windowManager, sendToPet: (command) => sent.push(command) });
  const changes = [];
  control.onChange((state) => changes.push(state));
  return { control, sent, windowCalls, changes };
}

describe('PetControl', () => {
  test('pause and resume tell the pet page', () => {
    const { control, sent } = setupControl();
    control.pause();
    control.pause(); // no repeat
    assert.equal(control.paused, true);
    control.resume();
    assert.deepEqual(sent, [{ type: 'pause', paused: true }, { type: 'pause', paused: false }]);
  });

  test('hiding hides the window and rests the pet; showing brings it back', () => {
    const { control, sent, windowCalls } = setupControl();
    control.hide();
    assert.equal(control.resting, true);
    control.show();
    assert.deepEqual(windowCalls, ['hide', 'show']);
    assert.deepEqual(sent.map((c) => c.paused), [true, false]);
  });

  test('showing a paused pet keeps it paused', () => {
    const { control, sent } = setupControl();
    control.pause();
    control.hide();
    control.show();
    assert.equal(control.resting, true);
    assert.deepEqual(sent.map((c) => c.paused), [true, true, true]);
  });

  test('show() on a visible pet just brings it to the front', () => {
    const { control, windowCalls, changes } = setupControl();
    control.show();
    assert.deepEqual(windowCalls, ['show']);
    assert.equal(changes.length, 0);
  });

  test('listeners get the full state', () => {
    const { control, changes } = setupControl();
    control.hide();
    assert.deepEqual(changes, [{ paused: false, hidden: true, resting: true }]);
  });
});

describe('tray menu', () => {
  const actions = new Proxy({}, { get: (_, name) => () => name });
  const base = { name: 'Pip', paused: false, hidden: false, characters: [['default', 'Pip']], currentCharacter: 'default', actions };
  const labels = (template) => template.filter((item) => item.label).map((item) => item.label);
  const find = (template, label) => template.find((item) => item.label === label);

  test('has the items from the spec, in order', () => {
    assert.deepEqual(labels(trayMenuTemplate(base)), ['Pip', 'Pause Pip', 'Resume Pip', 'Hide Pip', 'Settings...', 'Change character', 'Exit']);
  });

  test('only the pause item that applies is enabled', () => {
    const running = trayMenuTemplate(base);
    assert.equal(find(running, 'Pause Pip').enabled, true);
    assert.equal(find(running, 'Resume Pip').enabled, false);
    const paused = trayMenuTemplate({ ...base, paused: true });
    assert.equal(find(paused, 'Pause Pip').enabled, false);
    assert.equal(find(paused, 'Resume Pip').enabled, true);
    assert.equal(paused[0].label, 'Pip · paused');
  });

  test('a hidden pet offers Show instead of Hide', () => {
    const hidden = trayMenuTemplate({ ...base, hidden: true });
    assert.ok(find(hidden, 'Show Pip'));
    assert.equal(find(hidden, 'Hide Pip'), undefined);
    assert.equal(hidden[0].label, 'Pip · hidden');
  });

  test('lists characters with the current one checked', () => {
    const template = trayMenuTemplate({ ...base, characters: [['default', 'Pip'], ['robo', 'R&D Bot']], currentCharacter: 'robo' });
    const submenu = find(template, 'Change character').submenu;
    assert.deepEqual(submenu.map((item) => [item.label, item.checked]), [['Pip', false], ['R&&D Bot', true]]);
  });

  test('menu items call the right actions', () => {
    const template = trayMenuTemplate(base);
    assert.equal(find(template, 'Exit').click(), 'exit');
    assert.equal(find(template, 'Settings...').click(), 'openSettings');
  });

  test('tooltip shows the state', () => {
    assert.match(trayTooltip({ name: 'Pip', paused: true, hidden: false }), /paused/);
    assert.match(trayTooltip({ name: 'Pip', paused: false, hidden: true }), /hidden/);
    assert.match(trayTooltip({ name: 'Pip', paused: false, hidden: false }), /desktop pet/);
  });
});

describe('packIco', () => {
  test('writes a valid icon directory pointing at each PNG', () => {
    const png16 = Buffer.from('PNG-16'), png256 = Buffer.from('PNG-256!');
    const ico = packIco([{ size: 16, png: png16 }, { size: 256, png: png256 }]);
    assert.equal(ico.readUInt16LE(2), 1, 'type: icon');
    assert.equal(ico.readUInt16LE(4), 2, 'two images');
    assert.equal(ico[6], 16);
    assert.equal(ico[6 + 16], 0, '256 is stored as 0');
    const offset = ico.readUInt32LE(6 + 16 + 12);
    assert.equal(ico.subarray(offset, offset + png256.length).toString(), 'PNG-256!');
    assert.equal(ico.length, 6 + 32 + png16.length + png256.length);
  });

  test('rejects sizes Windows can’t store', () => {
    assert.throws(() => packIco([{ size: 512, png: Buffer.from('x') }]));
  });
});
