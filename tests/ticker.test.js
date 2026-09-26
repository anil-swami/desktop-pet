import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../src/renderer/core/Ticker.js';

// Stand-in for requestAnimationFrame: frames only run when the test flushes them.
function fakeFrames() {
  let nextId = 1;
  const queue = new Map();
  return {
    requestFrame: (callback) => { queue.set(nextId, callback); return nextId++; },
    cancelFrame: (id) => queue.delete(id),
    get pending() { return queue.size; },
    flush(time) {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

function setup() {
  const frames = fakeFrames();
  const errors = [];
  const ticker = new Ticker({ ...frames, now: () => 0, onError: (err) => errors.push(err) });
  return { frames, ticker, errors };
}

describe('Ticker', () => {
  test('only schedules frames while something is listening', () => {
    const { frames, ticker } = setup();
    assert.equal(frames.pending, 0);
    const received = [];
    const off = ticker.add((dt) => received.push(dt));
    assert.equal(frames.pending, 1);
    frames.flush(16);
    assert.deepEqual(received, [16]);
    assert.equal(frames.pending, 1);
    off();
    assert.equal(frames.pending, 0);
    assert.equal(ticker.running, false);
  });

  test('clamps huge gaps (e.g. after the PC slept)', () => {
    const { frames, ticker } = setup();
    const received = [];
    ticker.add((dt) => received.push(dt));
    frames.flush(60_000);
    assert.deepEqual(received, [100]);
  });

  test('swapping listeners inside a frame keeps exactly one frame scheduled', () => {
    const { frames, ticker } = setup();
    const second = () => {};
    const off = ticker.add(() => {
      off();
      ticker.add(second);
    });
    frames.flush(16);
    assert.equal(frames.pending, 1);
  });

  test('a throwing listener does not stop the others', () => {
    const { frames, ticker, errors } = setup();
    let calls = 0;
    ticker.add(() => { throw new Error('boom'); });
    ticker.add(() => { calls += 1; });
    frames.flush(16);
    frames.flush(32);
    assert.equal(calls, 2);
    assert.equal(errors.length, 2);
  });

  test('dispose cancels pending timers and frames', async () => {
    const { frames, ticker } = setup();
    let fired = false;
    ticker.after(10, () => { fired = true; });
    ticker.add(() => {});
    ticker.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(fired, false);
    assert.equal(frames.pending, 0);
  });
});
