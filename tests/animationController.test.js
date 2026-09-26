import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationController } from '../src/renderer/character/AnimationController.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView } from './helpers.js';

function setup() {
  const view = fakeView();
  const ticker = fakeTicker();
  const changes = [];
  const controller = new AnimationController({
    animations: TEST_ANIMATIONS,
    facing: 'right',
    view,
    ticker,
    onChange: (name) => changes.push(name),
  });
  return { view, ticker, controller, changes };
}

describe('AnimationController', () => {
  test('advances frames by elapsed time and loops', () => {
    const { view, ticker, controller } = setup();
    controller.play('walk');
    assert.equal(view.last.src, 'w1');
    ticker.tick(50);
    assert.equal(view.last.src, 'w1');
    ticker.tick(50);
    assert.equal(view.last.src, 'w2');
    ticker.tick(100);
    assert.equal(view.last.src, 'w3');
    ticker.tick(100);
    assert.equal(view.last.src, 'w1');
  });

  test('a large dt skips ahead by the right number of frames', () => {
    const { view, ticker, controller } = setup();
    controller.play('walk');
    ticker.tick(250);
    assert.equal(view.last.src, 'w3');
  });

  test('only redraws when the frame actually changes', () => {
    const { view, ticker, controller } = setup();
    controller.play('walk');
    for (let i = 0; i < 6; i += 1) ticker.tick(16);
    assert.equal(view.frames.length, 1);
  });

  test('a one-shot resolves true and hands over to its next animation', async () => {
    const { view, ticker, controller, changes } = setup();
    const done = controller.play('happy');
    ticker.tick(100);
    assert.equal(view.last.src, 'h2');
    ticker.tick(100);
    assert.equal(await done, true);
    assert.equal(controller.current, 'idle');
    assert.equal(view.last.src, 'idle');
    assert.deepEqual(changes, ['happy', 'idle']);
  });

  test('a one-shot without next holds its last frame and stops ticking', async () => {
    const { view, ticker, controller } = setup();
    const done = controller.play('jump');
    ticker.tick(200);
    assert.equal(await done, true);
    assert.equal(controller.current, 'jump');
    assert.equal(view.last.src, 'j2');
    assert.equal(ticker.listeners.size, 0);
  });

  test('interrupting an animation resolves its promise with false', async () => {
    const { controller } = setup();
    const walking = controller.play('walk');
    controller.play('idle');
    assert.equal(await walking, false);
  });

  test('requesting the current animation again does not restart it', () => {
    const { view, ticker, controller } = setup();
    const first = controller.play('walk');
    ticker.tick(100);
    assert.equal(controller.play('walk'), first);
    assert.equal(view.last.src, 'w2');
    controller.play('walk', { restart: true });
    assert.equal(view.last.src, 'w1');
  });

  test('an unknown animation resolves false and changes nothing', async () => {
    const { controller } = setup();
    controller.play('idle');
    assert.equal(await controller.play('moonwalk'), false);
    assert.equal(controller.current, 'idle');
  });

  test('a still pose does not keep the ticker running', () => {
    const { ticker, controller } = setup();
    controller.play('idle');
    assert.equal(ticker.listeners.size, 0);
    controller.play('walk');
    assert.equal(ticker.listeners.size, 1);
    controller.play('idle');
    assert.equal(ticker.listeners.size, 0);
  });

  test('mirrors frames when facing away from the artwork', () => {
    const { view, controller } = setup();
    controller.play('idle');
    assert.equal(view.last.mirrored, false);
    assert.equal(controller.setDirection('left'), true);
    assert.equal(view.last.mirrored, true);
    assert.equal(controller.setDirection('left'), false);
    assert.equal(controller.setDirection('up'), false);
    assert.equal(controller.direction, 'left');
  });

  test('passes the motion to the view', () => {
    const { view, controller } = setup();
    controller.play('walk');
    assert.deepEqual(view.animations.at(-1), { name: 'walk', motion: 'bob' });
  });
});
