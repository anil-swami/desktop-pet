import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MovementController } from '../src/renderer/character/MovementController.js';
import { fakeAnimator, fakeTicker, fakeView } from './helpers.js';

// Area 1000x600 with a 100px-wide pet: x can range from 50 to 950, ground is y = 600.
const OPTIONS = { walkSpeed: 100, runSpeed: 300, gravity: 1000, jumpSpeed: 500 };

function setup() {
  const ticker = fakeTicker();
  const animator = fakeAnimator();
  const view = fakeView();
  const movement = new MovementController({
    animator,
    view,
    ticker,
    size: { width: 100, height: 100 },
    area: { width: 1000, height: 600 },
    options: OPTIONS,
  });
  movement.placeAt(500);
  return { ticker, animator, view, movement };
}

// Step the simulation in 16 ms frames until `done()` or a safety limit.
function runUntil(ticker, done, maxFrames = 500) {
  for (let i = 0; i < maxFrames && !done(); i += 1) ticker.tick(16);
}

describe('MovementController', () => {
  test('starts on the ground, idle, without keeping the ticker busy', () => {
    const { movement, animator, ticker } = setup();
    assert.deepEqual(movement.position, { x: 500, y: 600 });
    assert.equal(animator.animation, 'idle');
    assert.equal(ticker.listeners.size, 0);
  });

  test('walks at walk speed in the chosen direction', () => {
    const { movement, animator, ticker } = setup();
    movement.walk('right');
    assert.equal(animator.animation, 'walk');
    ticker.tick(500);
    assert.equal(movement.position.x, 550);
    movement.walk('left');
    assert.equal(animator.direction, 'left');
    ticker.tick(500);
    assert.equal(movement.position.x, 500);
  });

  test('runs at run speed with the run animation', () => {
    const { movement, animator, ticker } = setup();
    movement.run('left');
    assert.equal(animator.animation, 'run');
    ticker.tick(1000);
    assert.equal(movement.position.x, 200);
  });

  test('ignores invalid directions', () => {
    const { movement, ticker } = setup();
    movement.walk('up');
    assert.equal(movement.mode, 'idle');
    assert.equal(ticker.listeners.size, 0);
  });

  test('stops at the screen edge and goes idle', () => {
    const { movement, animator, ticker } = setup();
    movement.placeAt(900);
    movement.walk('right');
    ticker.tick(1000);
    assert.equal(movement.position.x, 950);
    assert.equal(movement.mode, 'idle');
    assert.equal(animator.animation, 'idle');
    assert.equal(ticker.listeners.size, 0);
  });

  test('keeps the pet inside the area when placed', () => {
    const { movement } = setup();
    movement.placeAt(-200);
    assert.equal(movement.position.x, 50);
    movement.placeAt(5000, 900);
    assert.deepEqual(movement.position, { x: 950, y: 600 });
  });

  test('moveTo arrives exactly on target and resolves true', async () => {
    const { movement, animator, ticker } = setup();
    const arrived = movement.moveTo(700);
    assert.equal(animator.direction, 'right');
    ticker.tick(1000);
    assert.equal(movement.position.x, 600);
    ticker.tick(1500);
    assert.equal(movement.position.x, 700);
    assert.equal(await arrived, true);
    assert.equal(animator.animation, 'idle');
    assert.equal(ticker.listeners.size, 0);
  });

  test('moveTo clamps the target to the area', async () => {
    const { movement, ticker } = setup();
    const arrived = movement.moveTo(99999, { run: true });
    runUntil(ticker, () => !movement.isMoving);
    assert.equal(await arrived, true);
    assert.equal(movement.position.x, 950);
  });

  test('moveTo to the current spot resolves immediately', async () => {
    const { movement } = setup();
    assert.equal(await movement.moveTo(500), true);
    assert.equal(movement.mode, 'idle');
  });

  test('a new command interrupts moveTo, which resolves false', async () => {
    const { movement } = setup();
    const arrived = movement.moveTo(900);
    movement.walk('left');
    assert.equal(await arrived, false);
    assert.equal(movement.mode, 'walk');
  });

  test('moveTo keeps heading for its target even if the pet is turned', () => {
    const { movement, animator, ticker } = setup();
    movement.moveTo(700);
    animator.face('left');
    ticker.tick(100);
    assert.equal(animator.direction, 'right');
    assert.ok(movement.position.x > 500);
  });

  test('jump rises, falls under gravity and resolves on landing', async () => {
    const { movement, animator, ticker } = setup();
    const landed = movement.jump();
    assert.equal(animator.animation, 'jump');
    ticker.tick(16);
    assert.ok(movement.position.y < 600);
    let highest = 600;
    runUntil(ticker, () => {
      highest = Math.min(highest, movement.position.y);
      return movement.grounded;
    });
    assert.equal(await landed, true);
    assert.equal(movement.position.y, 600);
    assert.equal(animator.animation, 'idle');
    // Peak ≈ jumpSpeed² / (2 × gravity) = 125 px above the ground.
    assert.ok(highest > 460 && highest < 490, `peak at y=${highest}`);
  });

  test('cannot jump again while airborne', async () => {
    const { movement } = setup();
    movement.jump();
    assert.equal(await movement.jump(), false);
  });

  test('a running jump keeps its horizontal speed and lands running', () => {
    const { movement, animator, ticker } = setup();
    movement.run('right');
    movement.jump();
    ticker.tick(100);
    assert.equal(movement.position.x, 530);
    runUntil(ticker, () => movement.grounded);
    assert.equal(animator.animation, 'run');
  });

  test('placed in the air, the pet falls with the fall animation', () => {
    const { movement, animator, ticker } = setup();
    movement.placeAt(500, 100);
    assert.equal(animator.animation, 'fall');
    assert.equal(movement.grounded, false);
    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.position.y, 600);
    assert.equal(animator.animation, 'idle');
  });

  test('a smaller area pulls the pet back inside and onto the ground', () => {
    const { movement } = setup();
    movement.placeAt(900);
    movement.setArea({ width: 600, height: 400 });
    assert.deepEqual(movement.position, { x: 550, y: 400 });
    assert.equal(movement.grounded, true);
  });

  test('when the ground drops away, a standing pet falls to the new ground', () => {
    const { movement, animator, ticker } = setup();
    movement.setArea({ width: 1000, height: 800 });
    assert.equal(movement.grounded, false);
    assert.equal(animator.animation, 'fall');
    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.position.y, 800);
  });

  test('grabbing stops everything and holds the pet without ticking', async () => {
    const { movement, animator, ticker } = setup();
    const trip = movement.moveTo(900);
    movement.grab();
    assert.equal(await trip, false);
    assert.equal(movement.held, true);
    assert.equal(movement.mode, 'idle');
    assert.equal(animator.animation, 'fall');
    assert.equal(ticker.listeners.size, 0);
    movement.walk('left');
    assert.equal(movement.mode, 'idle');
    assert.equal(await movement.jump(), false);
  });

  test('a held pet follows dragTo, kept fully on screen', () => {
    const { movement } = setup();
    movement.grab();
    movement.dragTo(300, 250);
    assert.deepEqual(movement.position, { x: 300, y: 250 });
    movement.dragTo(-100, 10);
    assert.deepEqual(movement.position, { x: 50, y: 100 }); // top of a 100px-tall pet at y=0
    movement.dragTo(2000, 5000);
    assert.deepEqual(movement.position, { x: 950, y: 600 });
  });

  test('released in the air, the pet falls, lands and reports the fall height', async () => {
    const { movement, animator, ticker } = setup();
    movement.grab();
    movement.dragTo(500, 300);
    const landed = movement.release();
    assert.equal(animator.animation, 'fall');
    runUntil(ticker, () => movement.grounded);
    assert.equal(await landed, true);
    assert.equal(movement.position.y, 600);
    assert.equal(movement.lastFallHeight, 300);
    assert.equal(animator.animation, 'idle');
  });

  test('released on the ground, the pet simply stands', async () => {
    const { movement, animator } = setup();
    movement.grab();
    assert.equal(await movement.release(), true);
    assert.equal(movement.grounded, true);
    assert.equal(animator.animation, 'idle');
  });

  test('a thrown pet flies sideways and bounces off the screen edge', () => {
    const { movement, animator, ticker } = setup();
    movement.grab();
    movement.dragTo(850, 200);
    movement.release({ vx: 1000, vy: -200 });
    assert.equal(animator.direction, 'right');
    ticker.tick(16);
    assert.ok(movement.position.x > 850);
    runUntil(ticker, () => animator.direction === 'left');
    assert.equal(animator.direction, 'left'); // bounced
    runUntil(ticker, () => movement.grounded);
    assert.ok(movement.position.x < 950);
  });

  test('lands on a surface when falling onto it', () => {
    const { movement, animator, ticker } = setup();
    movement.setSurfaces([{ id: 'icon', left: 450, right: 550, top: 300 }]);
    movement.placeAt(500, 100);
    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.standingOn, 'icon');
    assert.equal(movement.position.y, 300);
    assert.equal(animator.animation, 'idle');
  });

  test('surfaces are one-way: jump up through, land on the way down', () => {
    const { movement, ticker } = setup();
    movement.setSurfaces([{ id: 'low', left: 450, right: 550, top: 540 }]); // 60px above the floor
    movement.jump();
    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.standingOn, 'low');
    assert.equal(movement.position.y, 540);
  });

  test('walking off the edge of a surface falls to the floor and keeps walking', () => {
    const { movement, animator, ticker } = setup();
    movement.setSurfaces([{ id: 'icon', left: 450, right: 550, top: 300 }]);
    movement.placeAt(500, 250);
    runUntil(ticker, () => movement.grounded);
    movement.walk('right');
    runUntil(ticker, () => !movement.grounded);
    assert.equal(movement.standingOn, null);
    assert.equal(animator.animation, 'fall');
    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.position.y, 600);
    assert.equal(animator.animation, 'walk');
  });

  test('removing or moving the surface under the pet makes it fall', () => {
    const { movement, ticker } = setup();
    const surface = { id: 'icon', left: 450, right: 550, top: 300 };
    movement.setSurfaces([surface]);
    movement.placeAt(500, 250);
    runUntil(ticker, () => movement.grounded);
    movement.setSurfaces([{ ...surface, top: 200 }]); // moved
    assert.equal(movement.grounded, false);

    runUntil(ticker, () => movement.grounded);
    assert.equal(movement.position.y, 600); // the moved surface is above now; floor catches it
    movement.setSurfaces([surface]);
    movement.placeAt(500, 250);
    runUntil(ticker, () => movement.grounded);
    movement.setSurfaces([]); // removed
    assert.equal(movement.grounded, false);
  });

  test('a pet standing on a surface does not fall when the floor moves', () => {
    const { movement, ticker } = setup();
    movement.setSurfaces([{ id: 'icon', left: 450, right: 550, top: 300 }]);
    movement.placeAt(500, 250);
    runUntil(ticker, () => movement.grounded);
    movement.setArea({ width: 1000, height: 700 });
    assert.equal(movement.grounded, true);
    assert.equal(movement.standingOn, 'icon');
  });

  test('jumpTo leaps in an arc and lands on the target surface', async () => {
    const { movement, animator, ticker } = setup();
    movement.setSurfaces([{ id: 'icon', left: 280, right: 320, top: 150 }]); // 450px up, 200px left
    const landed = movement.jumpTo(300, 150);
    assert.equal(animator.animation, 'jump');
    assert.equal(animator.direction, 'left');
    runUntil(ticker, () => movement.grounded);
    assert.equal(await landed, true);
    assert.equal(movement.standingOn, 'icon');
    assert.ok(Math.abs(movement.position.x - 300) < 1, `x=${movement.position.x}`);
  });

  test('jumpTo lands on target regardless of frame rate', () => {
    for (const frame of [8, 16, 33, 50]) {
      const { movement, ticker } = setup();
      movement.setSurfaces([{ id: 'icon', left: 690, right: 710, top: 200 }]);
      movement.jumpTo(700, 200);
      for (let i = 0; i < 500 && !movement.grounded; i += 1) ticker.tick(frame);
      assert.equal(movement.standingOn, 'icon', `at ${frame}ms frames`);
    }
  });

  test('jumpTo from a surface down to the floor', async () => {
    const { movement, ticker } = setup();
    movement.setSurfaces([{ id: 'icon', left: 450, right: 550, top: 300 }]);
    movement.placeAt(500, 250);
    runUntil(ticker, () => movement.grounded);
    const landed = movement.jumpTo(600, movement.floorY);
    movement.setSurfaces([]);
    runUntil(ticker, () => movement.grounded);
    assert.equal(await landed, true);
    assert.equal(movement.position.y, 600);
    assert.ok(Math.abs(movement.position.x - 600) < 1);
  });

  test('whenLanded resolves immediately on the ground, or on landing', async () => {
    const { movement, ticker } = setup();
    assert.equal(await movement.whenLanded(), true);
    movement.placeAt(500, 200);
    let landed = false;
    movement.whenLanded().then(() => { landed = true; });
    runUntil(ticker, () => movement.grounded);
    await Promise.resolve();
    assert.equal(landed, true);
  });

  test('renders every position change to the view', () => {
    const { movement, view, ticker } = setup();
    const before = view.positions.length;
    movement.walk('right');
    ticker.tick(100);
    assert.equal(view.positions.length, before + 1);
    assert.deepEqual(view.positions.at(-1), { x: 510, y: 600 });
  });
});
