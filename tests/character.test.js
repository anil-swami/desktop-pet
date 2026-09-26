import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView } from './helpers.js';

function setup(animations = TEST_ANIMATIONS) {
  const ticker = fakeTicker();
  const warnings = [];
  const log = { debug() {}, info() {}, warn: (m) => warnings.push(m), error() {} };
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
    log,
    random: () => 0.5,
  });
  return { character, ticker, warnings };
}

describe('Character', () => {
  test('blinks while idle, then schedules the next blink', () => {
    const { character, ticker } = setup();
    character.play('idle');
    assert.equal(ticker.timers.length, 1);
    assert.equal(ticker.timers[0].ms, 4500); // min + 0.5 * (max - min)

    ticker.timers[0].callback();
    assert.equal(character.animation, 'blink');
    ticker.tick(140);
    assert.equal(character.animation, 'idle');
    assert.equal(ticker.timers.length, 2);
  });

  test('cancels the pending blink when leaving idle', () => {
    const { character, ticker } = setup();
    character.play('idle');
    character.play('walk');
    assert.equal(ticker.timers[0].cancelled, true);
  });

  test('does not blink when blink only borrows idle frames', () => {
    const { character, ticker } = setup({ ...TEST_ANIMATIONS, blink: { ...TEST_ANIMATIONS.blink, aliasOf: 'idle' } });
    character.play('idle');
    assert.equal(ticker.timers.length, 0);
  });

  test('movement drives the matching animations', () => {
    const { character, ticker } = setup();
    character.placeAt(500);
    assert.equal(character.animation, 'idle');
    character.walk('left');
    assert.equal(character.animation, 'walk');
    assert.equal(character.direction, 'left');
    ticker.tick(1000);
    assert.ok(character.position.x < 500);
    character.stop();
    assert.equal(character.animation, 'idle');
  });

  test('turnAround flips direction', () => {
    const { character } = setup();
    character.play('idle');
    character.turnAround();
    assert.equal(character.direction, 'left');
    character.turnAround();
    assert.equal(character.direction, 'right');
  });

  test('warns about unknown animations instead of throwing', async () => {
    const { character, warnings } = setup();
    assert.equal(await character.play('moonwalk'), false);
    assert.match(warnings[0], /moonwalk/);
  });
});
