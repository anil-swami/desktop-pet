import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Random } from '../src/renderer/core/Random.js';
import { Personality } from '../src/renderer/behavior/Personality.js';
import { BehaviorScheduler } from '../src/renderer/behavior/BehaviorScheduler.js';

describe('Random', () => {
  test('a seed gives the same sequence every time', () => {
    const a = new Random(42), b = new Random(42);
    assert.deepEqual([a.float(), a.float(), a.float()], [b.float(), b.float(), b.float()]);
    assert.notEqual(new Random(1).float(), new Random(2).float());
  });

  test('int() stays within bounds, both ends included', () => {
    const random = new Random(7);
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(random.int(1, 3));
    assert.deepEqual([...seen].sort(), [1, 2, 3]);
  });

  test('weighted() follows the weights', () => {
    const random = new Random(3);
    const counts = { a: 0, b: 0, never: 0 };
    const entries = [{ name: 'a', weight: 3 }, { name: 'b', weight: 1 }, { name: 'never', weight: 0 }];
    for (let i = 0; i < 4000; i += 1) counts[random.weighted(entries).name] += 1;
    assert.equal(counts.never, 0);
    assert.ok(counts.a / counts.b > 2.5 && counts.a / counts.b < 3.5, JSON.stringify(counts));
  });
});

describe('Personality', () => {
  test('activities spend and restore energy', () => {
    const personality = new Personality({ energy: 50 });
    personality.spend('run', 10);
    assert.equal(personality.energy, 44);
    personality.spend('sleep', 10);
    assert.equal(personality.energy, 52);
  });

  test('values stay between 0 and 100', () => {
    const personality = new Personality({ energy: 5, boredom: 95 });
    personality.spend('run', 1000);
    assert.equal(personality.energy, 0);
    personality.spend('rest', 1000); // resting a long time: very bored
    personality.adjust({ boredom: +50 });
    assert.equal(personality.boredom, 100);
  });

  test('mood drifts back toward its baseline', () => {
    const personality = new Personality({ mood: 100 });
    personality.spend('rest', 60);
    assert.ok(personality.mood < 100 && personality.mood > 60);
  });

  test('mood labels', () => {
    assert.equal(new Personality({ mood: 80, energy: 80 }).moodLabel, 'happy');
    assert.equal(new Personality({ mood: 80, energy: 10 }).moodLabel, 'tired');
    assert.equal(new Personality({ mood: 20, energy: 80 }).moodLabel, 'grumpy');
  });
});

describe('BehaviorScheduler', () => {
  const activity = (name, weight, extra = {}) => ({ name, weight: () => weight, ...extra });

  test('never picks activities with zero weight', () => {
    const scheduler = new BehaviorScheduler({ random: new Random(1), now: () => 0 });
    for (let i = 0; i < 50; i += 1) {
      assert.equal(scheduler.choose([activity('a', 1, { cooldownMs: 0 }), activity('b', 0)], {}).name, 'a');
    }
  });

  test('respects cooldowns', () => {
    let time = 0;
    const scheduler = new BehaviorScheduler({ random: new Random(1), now: () => time });
    const list = [activity('dash', 100, { cooldownMs: 1000 }), activity('idle', 1)];
    assert.equal(scheduler.choose(list, {}).name, 'dash');
    time = 500;
    assert.equal(scheduler.choose(list, {}).name, 'idle');
    time = 1500;
    assert.equal(scheduler.choose(list, {}).name, 'dash');
  });

  test('a higher priority tier wins even with a lower weight', () => {
    const scheduler = new BehaviorScheduler({ random: new Random(1), now: () => 0 });
    const list = [activity('wander', 100), activity('nap', 0.1, { priority: () => 3 })];
    assert.equal(scheduler.choose(list, {}).name, 'nap');
  });

  test('returns null when nothing wants to run', () => {
    const scheduler = new BehaviorScheduler({ random: new Random(1), now: () => 0 });
    assert.equal(scheduler.choose([activity('a', 0)], {}), null);
  });
});
