import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Character } from '../src/renderer/character/Character.js';
import { MouseInteraction } from '../src/renderer/interaction/MouseInteraction.js';
import { TEST_ANIMATIONS, fakeTicker, fakeView, flush } from './helpers.js';

// Area 1000x600; a 100x100 pet standing at x=500 has its centre at (500, 550).
function setup({ mode, x = 500 } = {}) {
  const ticker = fakeTicker();
  const character = new Character({
    data: { name: 'Test', facing: 'right', width: 100, height: 100, animations: TEST_ANIMATIONS },
    view: fakeView(),
    ticker,
    area: { width: 1000, height: 600 },
  });
  character.placeAt(x);

  let time = 10_000;
  const holds = { count: 0 };
  const mouse = new MouseInteraction({
    character,
    ticker,
    now: () => time,
    holdPointer: () => {
      holds.count += 1;
      return () => { holds.count -= 1; };
    },
  });
  if (mode) mouse.setMode(mode);

  const api = {
    character, mouse, ticker, holds,
    advance: (ms) => { time += ms; },
    move: (px, py, dt = 120) => { time += dt; mouse.handlePointerMove(px, py, time); },
    down: (px, py) => mouse.handlePointerDown(px, py, time),
    up: (px, py, dt = 50) => { time += dt; mouse.handlePointerUp(px, py, time); },
    click: (px = 500, py = 550) => { api.down(px, py); api.up(px, py); },
    runUntil: (done, max = 500) => { for (let i = 0; i < max && !done(); i += 1) ticker.tick(16); },
  };
  return api;
}

describe('MouseInteraction: noticing', () => {
  test('notices a nearby cursor and turns to look at it', () => {
    const { mouse, character, move } = setup();
    move(320, 550); // 180px to the left of the pet's centre
    assert.equal(mouse.noticed, true);
    assert.equal(character.direction, 'left');
  });

  test('ignores a cursor far away', () => {
    const { mouse, character, move } = setup();
    move(100, 100);
    assert.equal(mouse.noticed, false);
    assert.equal(character.direction, 'right');
  });

  test('stays interested until the cursor is well away (no flicker at the edge)', () => {
    const { mouse, move } = setup();
    move(700, 550); // 200px: noticed
    move(760, 550); // 260px: between notice (220) and forget (300)
    assert.equal(mouse.noticed, true);
    move(820, 550); // 320px: forgotten
    assert.equal(mouse.noticed, false);
  });

  test('turns at most once per cooldown', () => {
    const { character, move } = setup();
    move(350, 550);
    assert.equal(character.direction, 'left');
    move(650, 550); // other side, but only 120ms later
    assert.equal(character.direction, 'left');
    move(650, 551, 1200);
    assert.equal(character.direction, 'right');
  });

  test('does not turn while walking', () => {
    const { character, move } = setup();
    character.walk('right');
    move(350, 550);
    assert.equal(character.direction, 'right');
  });

  test('a fast dash close by startles the pet, then not again for a while', () => {
    const { character, move, ticker, runUntil } = setup();
    move(900, 550);
    move(700, 550, 50);
    move(560, 550, 60); // fast and close
    assert.equal(character.animation, 'surprised');
    runUntil(() => character.animation === 'idle');
    move(900, 550, 400);
    move(700, 550, 50);
    move(560, 550, 60);
    assert.notEqual(character.animation, 'surprised');
    assert.equal(ticker.listeners.size, 0); // nothing left animating
  });

  test('"off" ignores the cursor completely', () => {
    const { mouse, character, move } = setup({ mode: 'off' });
    move(350, 550);
    assert.equal(mouse.noticed, false);
    assert.equal(character.direction, 'right');
  });
});

describe('MouseInteraction: clicks', () => {
  test('a click makes the pet happy; many quick pokes make it confused', () => {
    const { character, click, advance } = setup();
    click();
    assert.equal(character.animation, 'happy');
    advance(300); click();
    advance(300); click();
    advance(300); click();
    assert.equal(character.animation, 'confused');
  });

  test('a clicked walking pet stops for its reaction, then walks on', async () => {
    const { character, click, runUntil } = setup();
    character.walk('left');
    click();
    assert.equal(character.animation, 'happy');
    assert.equal(character.isMoving, false);
    runUntil(() => character.animation !== 'happy');
    await flush();
    assert.equal(character.mode, 'walk');
    assert.equal(character.direction, 'left');
  });

  test('the window keeps the mouse for the whole press', () => {
    const { holds, down, up } = setup();
    down(500, 550);
    assert.equal(holds.count, 1);
    up(500, 550);
    assert.equal(holds.count, 0);
  });
});

describe('MouseInteraction: drag and drop', () => {
  test('moving a press past the threshold picks the pet up', () => {
    const { character, mouse, down, move } = setup();
    down(500, 550);
    move(502, 550, 16);
    assert.equal(character.held, false); // 2px: still a click
    move(510, 550, 16);
    assert.equal(character.held, true);
    assert.equal(mouse.dragging, true);
    assert.equal(character.animation, 'fall');
  });

  test('the pet stays under the cursor where it was grabbed', () => {
    const { character, down, move } = setup();
    down(500, 550);
    move(510, 550, 16); // grabbed 10px right of centre, 50px above the feet
    move(600, 300, 16);
    assert.deepEqual(character.position, { x: 590, y: 350 });
  });

  test('a small drop lands and carries on walking', async () => {
    const { character, down, move, up, runUntil } = setup();
    character.walk('right');
    down(500, 550);
    move(500, 540, 16);
    move(500, 450, 16); // lifted 100px
    up(500, 450, 300);  // held still before letting go: no throw
    runUntil(() => character.grounded);
    await flush();
    assert.equal(character.animation, 'walk');
    assert.equal(character.direction, 'right');
  });

  test('a big drop makes the pet dizzy before it carries on', async () => {
    const { character, down, move, up, runUntil } = setup();
    character.walk('left');
    down(500, 550);
    move(500, 540, 16);
    move(500, 200, 16);
    up(500, 200, 300);
    runUntil(() => character.grounded);
    await flush();
    assert.equal(character.animation, 'confused');
    runUntil(() => character.animation !== 'confused');
    await flush();
    assert.equal(character.mode, 'walk');
    assert.equal(character.direction, 'left');
  });

  test('a flick throws the pet in that direction', () => {
    const { character, down, move, up, ticker } = setup();
    down(500, 550);
    move(500, 540, 16);
    move(500, 300, 16);
    move(560, 300, 20);
    move(620, 300, 20); // moving right at ~3000px/s when released
    up(620, 300, 10);
    const x = character.position.x;
    ticker.tick(16);
    assert.ok(character.position.x > x);
  });
});

describe('MouseInteraction: modes', () => {
  test('follow walks toward the cursor and stops underneath it', async () => {
    const { character, move, runUntil } = setup({ mode: 'follow' });
    move(750, 300);
    assert.equal(character.mode, 'walk');
    assert.equal(character.direction, 'right');
    runUntil(() => !character.isMoving);
    assert.equal(character.position.x, 750);
  });

  test('follow runs when the cursor is far away', () => {
    const { character, move } = setup({ mode: 'follow' });
    move(950, 300);
    assert.equal(character.mode, 'run');
  });

  test('follow jumps to reach a cursor just above its head', () => {
    const { character, move } = setup({ mode: 'follow' });
    move(505, 440); // 60px above the head
    assert.equal(character.grounded, false);
  });

  test('leaving follow mode stops the chase', () => {
    const { character, mouse, move } = setup({ mode: 'follow' });
    move(900, 300);
    mouse.setMode('curious');
    assert.equal(character.isMoving, false);
  });

  test('shy runs away from a close cursor', () => {
    const { character, move } = setup({ mode: 'shy' });
    move(560, 550);
    assert.equal(character.mode, 'run');
    assert.equal(character.direction, 'left');
  });

  test('a cornered shy pet dashes past the cursor instead', () => {
    const { character, move } = setup({ mode: 'shy', x: 60 });
    move(110, 550);
    assert.equal(character.mode, 'run');
    assert.equal(character.direction, 'right');
  });
});
