// Settings-driven tuning: movement speed, animation speed, frame rate, pace.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { AnimationController } from '../src/renderer/character/AnimationController.js';
import { BehaviorManager } from '../src/renderer/behavior/BehaviorManager.js';
import { Ticker } from '../src/renderer/core/Ticker.js';
import { Random } from '../src/renderer/core/Random.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView, flush } from './helpers.js';

function makeCharacter(ticker = fakeTicker()) {
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations: TEST_ANIMATIONS },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
  });
  character.placeAt(500);
  return { character, ticker };
}

describe('tuning', () => {
  test('walking speed can change on the fly', () => {
    const { character, ticker } = makeCharacter();
    character.setMovementOptions({ walkSpeed: 120 });
    character.walk('right');
    ticker.tick(500);
    assert.equal(character.position.x, 560);
  });

  test('bad speed values are ignored', () => {
    const { character, ticker } = makeCharacter();
    character.setMovementOptions({ walkSpeed: -5, runSpeed: Number.NaN });
    character.walk('right');
    ticker.tick(1000);
    assert.equal(character.position.x, 560); // still the default 60 px/s
  });

  test('animation speed makes frames advance faster', () => {
    const ticker = fakeTicker();
    const view = fakeView();
    const controller = new AnimationController({ animations: TEST_ANIMATIONS, view, ticker });
    controller.setSpeed(2);
    controller.play('walk');
    ticker.tick(50); // 50 ms at double speed = one 100 ms frame
    assert.equal(view.last.src, 'w2');
  });

  test('battery saver: the loop updates at most every 33 ms, without losing time', () => {
    const queue = [];
    const ticker = new Ticker({ requestFrame: (cb) => queue.push(cb), cancelFrame() {}, now: () => 0 });
    ticker.setFrameInterval(33);
    const received = [];
    ticker.add((dt) => received.push(dt));
    for (const time of [16, 32, 48, 64, 80]) queue.shift()(time);
    // Frames at 16, 48 and 80 ms are skipped; the updates at 32 and 64 get the full 32 ms each.
    assert.deepEqual(received, [32, 32]);
  });
});

describe('pace (settings: Activity)', () => {
  const managers = [];
  afterEach(() => { for (const m of managers.splice(0)) m.stop(); });

  test('stretches the waits inside activities', async () => {
    const waits = [];
    const ticker = fakeTicker();
    const originalAfter = ticker.after.bind(ticker);
    ticker.after = (ms, cb) => { waits.push(ms); return originalAfter(ms, cb); };
    const { character } = makeCharacter(ticker);
    const manager = new BehaviorManager({
      character,
      ticker,
      random: new Random(1),
      now: () => 0,
      activities: [{ name: 'rest', state: 'IDLE', kind: 'rest', weight: () => 1, async run({ wait }) { await wait(1000); } }],
    });
    managers.push(manager);
    manager.setPace(1.6);
    manager.start();
    await flush();
    assert.ok(waits.includes(1600), `waits: ${waits.join(', ')}`);
  });
});
