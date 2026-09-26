import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { BehaviorManager } from '../src/renderer/behavior/BehaviorManager.js';
import { Personality } from '../src/renderer/behavior/Personality.js';
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

function setup({ activities, freeIcons = 0, personality, busy = false } = {}) {
  const ticker = fakeTicker();
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations: ANIMATIONS },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
  });
  character.placeAt(500);
  const visits = [];
  const desktop = {
    freeIconCount: async () => freeIcons,
    visit: async (target) => { visits.push(target); return true; },
    leave: async () => true,
  };
  let time = 0;
  const state = { busy };
  const manager = new BehaviorManager({
    character,
    desktop,
    ticker,
    random: new Random(11),
    personality: new Personality(personality),
    now: () => time,
    isBusy: () => state.busy,
    ...(activities ? { activities } : {}),
  });
  managers.push(manager);

  // Advance the world one step: fire pending timers, animate half a second,
  // and let promise chains settle.
  const run = async (steps = 1) => {
    for (let i = 0; i < steps; i += 1) {
      time += 500;
      ticker.runTimers();
      ticker.tick(250);
      ticker.tick(250);
      await flush();
    }
  };
  // Step until `done()` (at most `max` steps); returns the states seen on the way.
  const runUntil = async (done, max = 40) => {
    const seen = [];
    for (let i = 0; i < max && !done(); i += 1) {
      await run(1);
      seen.push(manager.state);
    }
    return seen;
  };
  return { manager, character, ticker, visits, run, runUntil, state, advance: (ms) => { time += ms; } };
}

// A simple activity that records runs and waits for a while.
function recorder(name, state = 'IDLE', { weight = 1, waitMs = 1000 } = {}) {
  const runs = [];
  return {
    runs,
    activity: {
      name, state, kind: 'rest', weight: () => weight,
      async run({ wait }) {
        runs.push('start');
        runs.push((await wait(waitMs)) ? 'finished' : 'interrupted');
      },
    },
  };
}

describe('BehaviorManager', () => {
  test('picks an activity and runs it, updating the state', async () => {
    const walk = recorder('stroll', 'WALKING');
    const { manager, run } = setup({ activities: [walk.activity] });
    manager.start();
    await run(1);
    assert.equal(manager.state, 'WALKING');
    await run(3);
    assert.deepEqual(walk.runs.slice(0, 2), ['start', 'finished']);
  });

  test('interrupt() ends the current activity and pauses', async () => {
    const long = recorder('long', 'SITTING', { waitMs: 60_000 });
    const { manager, run, advance } = setup({ activities: [long.activity] });
    manager.start();
    await flush();
    assert.deepEqual(long.runs, ['start']);
    manager.interrupt('user clicked', 5000);
    await flush();
    assert.deepEqual(long.runs, ['start', 'interrupted']);
    await run(1);
    assert.equal(long.runs.length, 2, 'nothing new during the pause');
    advance(6000);
    await run(2);
    assert.ok(long.runs.length > 2, 'resumes after the pause');
  });

  test('waits while the mouse is busy with the pet', async () => {
    const walk = recorder('stroll', 'WALKING');
    const { manager, run, state } = setup({ activities: [walk.activity], busy: true });
    manager.start();
    await run(3);
    assert.equal(walk.runs.length, 0);
    state.busy = false;
    await run(2);
    assert.ok(walk.runs.length > 0);
  });

  test('switched off, it does nothing', async () => {
    const walk = recorder('stroll', 'WALKING');
    const { manager, run } = setup({ activities: [walk.activity] });
    manager.setEnabled(false);
    manager.start();
    await run(3);
    assert.equal(walk.runs.length, 0);
    assert.equal(manager.state, 'OFF');
  });

  test('when the user is away it naps; when they come back it wakes up happy', async () => {
    const { manager, character, runUntil } = setup();
    manager.start();
    manager.setUserAway(true);
    await runUntil(() => manager.state === 'SLEEPING');
    assert.equal(manager.state, 'SLEEPING');
    assert.equal(character.animation, 'sleep');

    manager.setUserAway(false);
    const seen = await runUntil(() => manager.state === 'HAPPY', 3);
    assert.ok(seen.includes('HAPPY'), seen.join(','));
  });

  test('the desktop appearing: a happy reaction, then icon hopping', async () => {
    const { manager, visits, run, runUntil } = setup({ freeIcons: 5 });
    manager.start();
    await run(1);
    manager.onAppChanged({ category: 'desktop', app: 'desktop', maximized: false, fullscreen: false });
    const seen = await runUntil(() => visits.length > 0, 10);
    assert.ok(seen.includes('HAPPY'), seen.join(','));
    assert.ok(visits.length > 0, 'visited an icon');
  });

  test('a maximized app hides the icons: no visits', async () => {
    const { manager, visits, run } = setup({ freeIcons: 5 });
    manager.onAppChanged({ category: 'code', app: 'code', maximized: true, fullscreen: false });
    manager.start();
    await run(30);
    assert.equal(visits.length, 0);
  });

  test('a fullscreen app calms the pet down (no running around)', async () => {
    const { manager, character, run } = setup({ personality: { energy: 100, boredom: 100 } });
    manager.onAppChanged({ category: 'media', app: 'vlc', maximized: false, fullscreen: true });
    manager.start();
    const states = new Set();
    for (let i = 0; i < 40; i += 1) {
      await run(1);
      states.add(manager.state);
      assert.equal(character.mode, 'idle', `moving in state ${manager.state}`);
    }
    assert.ok(!states.has('RUNNING') && !states.has('PLAYING'), [...states].join(','));
  });

  test('app reactions have cooldowns', async () => {
    const { manager, run, advance } = setup();
    manager.start();
    manager.onAppChanged({ category: 'code', app: 'code', maximized: false, fullscreen: false });
    await run(1);
    assert.equal(manager.state, 'HAPPY');
    await run(4);
    advance(60_000); // past the 30 s gap, within the 5 min cooldown for "code"
    manager.onAppChanged({ category: 'browser', app: 'chrome', maximized: false, fullscreen: false });
    await run(1);
    advance(60_000);
    manager.onAppChanged({ category: 'code', app: 'code', maximized: false, fullscreen: false });
    await run(1);
    assert.notEqual(manager.state, 'HAPPY');
  });

  test('only newly opened folders get a reaction', async () => {
    const { manager, run, runUntil } = setup();
    manager.start();
    manager.onAppChanged({ category: 'folder', app: 'explorer', maximized: false, fullscreen: false, newFolder: false });
    const before = await runUntil(() => false, 4);
    assert.ok(!before.includes('SURPRISED'), before.join(','));
    manager.onAppChanged({ category: 'folder', app: 'explorer', maximized: false, fullscreen: false, newFolder: true });
    await run(1);
    assert.equal(manager.state, 'SURPRISED');
  });

  test('describe() has the spec shape', () => {
    const { manager } = setup();
    const info = manager.describe();
    for (const key of ['mood', 'energy', 'curiosity', 'boredom', 'activity', 'attention', 'state', 'enabled']) {
      assert.ok(key in info, key);
    }
  });
});
