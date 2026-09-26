import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { BehaviorManager } from '../src/renderer/behavior/BehaviorManager.js';
import { ORDERS } from '../src/renderer/behavior/orders.js';
import { ACTIVITIES } from '../src/renderer/behavior/activities.js';
import { Personality } from '../src/renderer/behavior/Personality.js';
import { Treats } from '../src/renderer/interaction/Treats.js';
import { Random } from '../src/renderer/core/Random.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView, flush, frame } from './helpers.js';

const ANIMATIONS = {
  ...TEST_ANIMATIONS,
  sit: { frames: [frame('sit')], loop: true, next: null, motion: null, aliasOf: null },
  sleep: { frames: [frame('zz')], loop: true, next: null, motion: null, aliasOf: null },
  wake: { frames: [frame('wake')], loop: false, next: 'idle', motion: null, aliasOf: null },
};

const managers = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
});

// A quiet autonomy (a harmless idle, plus the real "eat leftovers"), so only orders move the pet.
const idleRuns = { count: 0 };
const IDLE_ONLY = [
  { name: 'idle', state: 'IDLE', kind: 'rest', weight: () => 1, async run({ wait }) { idleRuns.count += 1; await wait(1000); } },
  ACTIVITIES.find((activity) => activity.name === 'eat-leftovers'),
];

function setup({ enabled = true } = {}) {
  const ticker = fakeTicker();
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations: ANIMATIONS },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
  });
  character.placeAt(500);
  const said = [];
  const hearts = { count: 0 };
  const cursor = { position: null };
  const treats = new Treats({ view: { add() {}, move() {}, remove() {} }, ticker, getFloorY: () => 600 });
  const personality = new Personality({ energy: 50, mood: 50 });
  let time = 0;
  const manager = new BehaviorManager({
    character,
    ticker,
    random: new Random(4),
    personality,
    activities: IDLE_ONLY,
    now: () => time,
    speak: (line) => said.push(line.topic),
    tools: { treats, effects: { hearts() { hearts.count += 1; } }, pointer: () => cursor.position },
    extraContext: () => ({ treats: treats.count }),
  });
  managers.push(manager);
  if (!enabled) manager.setEnabled(false);
  manager.start();

  const run = async (steps = 1) => {
    for (let i = 0; i < steps; i += 1) {
      time += 150;
      ticker.runTimers();
      ticker.tick(150);
      await flush();
    }
  };
  return { manager, character, treats, personality, said, hearts, cursor, run, advance: (ms) => { time += ms; } };
}

describe('Orders', () => {
  test('sit: sits and says so', async () => {
    const { manager, character, said, run } = setup();
    manager.order(ORDERS.sit);
    await run(1);
    assert.equal(manager.state, 'SITTING');
    assert.equal(character.animation, 'sit');
    assert.ok(said.includes('sitOk'));
  });

  test('orders run even when "Live on its own" is off', async () => {
    const { manager, character, run } = setup({ enabled: false });
    manager.order(ORDERS.sit);
    await run(1);
    assert.equal(character.animation, 'sit');
  });

  test('orders ignore an earlier pause', async () => {
    const { manager, character, run } = setup();
    manager.interrupt('menu command', 60_000);
    manager.order(ORDERS.sit);
    await run(1);
    assert.equal(character.animation, 'sit');
  });

  test('a new order replaces the one still running', async () => {
    const { manager, character, run } = setup();
    manager.order(ORDERS.sit);
    await run(1);
    manager.order(ORDERS.sleep);
    await run(1);
    assert.equal(manager.state, 'SLEEPING');
    assert.equal(character.animation, 'sleep');
  });

  test('stop: stands still, then autonomy waits (holdMs)', async () => {
    const { manager, character, run, advance } = setup();
    character.walk('right');
    manager.order(ORDERS.stop);
    await run(2);
    assert.equal(character.mode, 'idle');
    const before = idleRuns.count;
    await run(5);
    assert.equal(idleRuns.count, before, 'autonomy holds off');
    advance(31_000);
    await run(2);
    assert.ok(idleRuns.count > before, 'autonomy resumes after the hold');
  });

  test('come here: follows the cursor, then stops when it settles', async () => {
    const { manager, character, cursor, run, said } = setup();
    cursor.position = { x: 800, y: 300 };
    manager.order(ORDERS.come);
    await run(1);
    assert.equal(character.mode, 'run');
    for (let i = 0; i < 60 && !said.includes('comeHere'); i += 1) await run(1);
    assert.ok(Math.abs(character.position.x - 800) <= 30, `x=${character.position.x}`);
    assert.ok(said.includes('comeHere'));
    assert.equal(character.mode, 'idle');
  });

  test('pet: hearts, a happy wiggle, better mood', async () => {
    const { manager, character, hearts, personality, run } = setup();
    manager.order(ORDERS.pet);
    await run(1);
    assert.equal(hearts.count, 1);
    assert.equal(character.animation, 'happy');
    assert.equal(personality.mood, 58);
  });

  test('feed: a treat drops nearby, the pet goes and eats it', async () => {
    const { manager, character, treats, personality, said, run } = setup();
    manager.order(ORDERS.feed);
    await run(1);
    assert.equal(treats.count, 1);
    const treatX = treats.nearest(character.position.x).x;
    for (let i = 0; i < 80 && treats.count > 0; i += 1) await run(1);
    assert.equal(treats.count, 0, 'eaten');
    assert.ok(Math.abs(Math.abs(character.position.x - treatX) - 30) < 1, 'stopped just in front of it');
    assert.equal(character.direction, treatX > character.position.x ? 'right' : 'left', 'facing it');
    assert.equal(personality.energy, 70);
    assert.ok(said.includes('eat'));
  });

  test('a leftover treat is eaten later by autonomy', async () => {
    const { treats, run } = setup();
    treats.spawn(700, 600);
    for (let i = 0; i < 80 && treats.count > 0; i += 1) await run(1);
    assert.equal(treats.count, 0);
  });

  test('zoomies: runs to one side, then the other', async () => {
    const { manager, character, run } = setup();
    manager.order(ORDERS.zoomies);
    await run(1);
    assert.equal(character.mode, 'run');
    const directions = new Set();
    for (let i = 0; i < 80; i += 1) {
      await run(1);
      if (character.mode === 'run') directions.add(character.direction);
    }
    assert.deepEqual([...directions].sort(), ['left', 'right']);
  });
});
