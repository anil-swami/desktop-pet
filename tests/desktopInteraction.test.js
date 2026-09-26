import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { DesktopInteraction } from '../src/renderer/interaction/DesktopInteraction.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView, flush, frame } from './helpers.js';

const ANIMATIONS = { ...TEST_ANIMATIONS, sit: { frames: [frame('sit')], loop: true, next: null, motion: null, aliasOf: null } };

// Area 1000x600, pet 100x100 standing at x=500. Icons in window coordinates.
const FOLDER = { id: 'aaaaaaaaaaaa', name: 'Projects', kind: 'folder', x: 200, y: 300, width: 90, height: 120, occluded: false };
const COVERED = { id: 'bbbbbbbbbbbb', name: 'Notes', kind: 'file', x: 600, y: 300, width: 90, height: 120, occluded: true };
const TOO_HIGH = { id: 'cccccccccccc', name: 'This PC', kind: 'system', x: 800, y: 20, width: 90, height: 120, occluded: false };

function setup(icons = [FOLDER, COVERED, TOO_HIGH]) {
  const ticker = fakeTicker();
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations: ANIMATIONS },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
  });
  character.placeAt(500);
  const scan = { available: true, visible: true, icons: structuredClone(icons) }; // tests may change it
  const logs = [];
  const log = { debug() {}, info: (m) => logs.push(m), warn: (m) => logs.push(m), error() {} };
  const desktop = new DesktopInteraction({ character, getIcons: async () => structuredClone(scan), ticker, log, random: () => 0 });
  return { character, desktop, ticker, scan, logs };
}

// Keep the simulation running until the promise settles.
async function drive(promise, ticker, maxFrames = 3000) {
  let settled = false;
  let value;
  promise.then((result) => { settled = true; value = result; });
  for (let i = 0; i < maxFrames && !settled; i += 1) {
    ticker.tick(16);
    await flush();
  }
  assert.ok(settled, 'did not finish');
  return value;
}

async function sitOnFolder(context) {
  assert.equal(await drive(context.desktop.visit(FOLDER.id), context.ticker), true);
}

describe('DesktopInteraction', () => {
  test('walks over, leaps onto an icon and sits on it', async () => {
    const context = setup();
    const { character, desktop } = context;
    await sitOnFolder(context);
    assert.equal(character.standingOn, FOLDER.id);
    assert.equal(character.position.y, FOLDER.y);
    assert.ok(Math.abs(character.position.x - 245) < 1); // icon centre
    assert.equal(character.animation, 'sit');
    assert.equal(desktop.visiting.id, FOLDER.id);
  });

  test('only covered-free icons with room above count as visitable', () => {
    const { desktop, scan } = setup();
    assert.deepEqual(desktop.visitable(scan).map((icon) => icon.id), [FOLDER.id]);
  });

  test('a random visit picks a free icon', async () => {
    const { desktop, ticker, character } = setup();
    assert.equal(await drive(desktop.visit('random'), ticker), true);
    assert.equal(character.standingOn, FOLDER.id);
  });

  test('says why when nothing can be visited', async () => {
    const context = setup([COVERED, TOO_HIGH]);
    assert.equal(await drive(context.desktop.visit('random'), context.ticker), false);
    assert.match(context.logs.at(-1), /icon is free to visit/);

    const hidden = setup();
    hidden.scan.visible = false;
    assert.equal(await drive(hidden.desktop.visit('random'), hidden.ticker), false);
    assert.match(hidden.logs.at(-1), /hidden/);
  });

  test('hop down lands on the floor beside the icon', async () => {
    const context = setup();
    const { character, desktop, ticker } = context;
    await sitOnFolder(context);
    assert.equal(await drive(desktop.leave(), ticker), true);
    assert.equal(character.standingOn, null);
    assert.equal(character.position.y, 600);
    assert.equal(desktop.visiting, null);
  });

  test('hops off when a window covers the icon', async () => {
    const context = setup();
    const { character, desktop, ticker, scan } = context;
    await sitOnFolder(context);
    scan.icons[0].occluded = true;
    for (let i = 0; i < 5; i += 1) { ticker.runTimers(); await flush(); } // 5 checks: the 5th rescans
    assert.equal(desktop.visiting, null);
    assert.match(context.logs.at(-1), /Hopping down/);
    await drive(character.whenLanded(), ticker);
    assert.equal(character.position.y, 600);
  });

  test('falls when the icon disappears', async () => {
    const context = setup();
    const { character, desktop, ticker, scan } = context;
    await sitOnFolder(context);
    scan.icons.splice(0, 1);
    for (let i = 0; i < 5; i += 1) { ticker.runTimers(); await flush(); }
    assert.equal(desktop.visiting, null);
    assert.equal(character.grounded, false);
    assert.equal(character.animation, 'fall');
  });

  test('notices when the pet has left the icon some other way', async () => {
    const context = setup();
    const { character, desktop, ticker } = context;
    await sitOnFolder(context);
    character.grab();
    ticker.runTimers();
    await flush();
    assert.equal(desktop.visiting, null);
  });

  test('leaps straight from one icon to another', async () => {
    const SECOND = { ...FOLDER, id: 'dddddddddddd', name: 'Photos', x: 400, y: 250 };
    const context = setup([FOLDER, SECOND]);
    const { character, desktop, ticker } = context;
    await sitOnFolder(context);
    const trip = desktop.visit(SECOND.id);
    await flush();
    assert.equal(character.grounded, false, 'took off from the icon, not the floor');
    assert.equal(await drive(trip, ticker), true);
    assert.equal(character.standingOn, SECOND.id);
    assert.equal(character.position.y, SECOND.y);
  });

  test('a random visit never picks the icon already sat on', async () => {
    const SECOND = { ...FOLDER, id: 'dddddddddddd', name: 'Photos', x: 400, y: 250 };
    const context = setup([FOLDER, SECOND]);
    await sitOnFolder(context);
    assert.equal(await context.desktop.freeIconCount(), 1);
    assert.equal(await drive(context.desktop.visit('random'), context.ticker), true);
    assert.equal(context.character.standingOn, SECOND.id);
  });

  test('cancel() during the walk abandons the visit', async () => {
    const { character, desktop, ticker } = setup();
    const visiting = desktop.visit(FOLDER.id);
    for (let i = 0; i < 20; i += 1) { ticker.tick(16); await flush(); }
    desktop.cancel();
    character.stop();
    assert.equal(await drive(visiting, ticker), false);
    assert.equal(character.standingOn, null);
  });
});
