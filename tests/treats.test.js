import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Treats } from '../src/renderer/interaction/Treats.js';
import { fakeTicker } from './helpers.js';

function setup({ max } = {}) {
  const ticker = fakeTicker();
  const view = {
    added: [], moved: 0, removed: [],
    add(treat) { this.added.push(treat.id); },
    move() { this.moved += 1; },
    remove(treat, { eaten }) { this.removed.push({ id: treat.id, eaten }); },
  };
  const treats = new Treats({ view, ticker, getFloorY: () => 600, ...(max ? { max } : {}) });
  const fall = () => { for (let i = 0; i < 200 && ticker.listeners.size > 0; i += 1) ticker.tick(16); };
  return { treats, view, ticker, fall };
}

describe('Treats', () => {
  test('a dropped treat falls to the floor and lands', async () => {
    const { treats, fall, ticker } = setup();
    const treat = treats.spawn(300, 300);
    const landed = treats.whenLanded(treat);
    assert.equal(treat.landed, false);
    fall();
    assert.equal(await landed, true);
    assert.equal(treat.y, 600);
    assert.equal(ticker.listeners.size, 0, 'no ticking once everything has landed');
  });

  test('never spawns below the floor', () => {
    const { treats } = setup();
    assert.equal(treats.spawn(300, 900).y, 600);
  });

  test('keeps at most a few treats around', () => {
    const { treats } = setup({ max: 2 });
    assert.ok(treats.spawn(100, 0));
    assert.ok(treats.spawn(200, 0));
    assert.equal(treats.spawn(300, 0), null);
    assert.equal(treats.count, 2);
  });

  test('finds the nearest treat', () => {
    const { treats } = setup();
    treats.spawn(100, 0);
    const near = treats.spawn(450, 0);
    assert.equal(treats.nearest(500), near);
    assert.equal(setup().treats.nearest(500), null);
  });

  test('eating removes it (with crumbs), only once', () => {
    const { treats, view } = setup();
    const treat = treats.spawn(100, 0);
    assert.equal(treats.eat(treat), true);
    assert.equal(treats.eat(treat), false);
    assert.equal(treats.count, 0);
    assert.deepEqual(view.removed, [{ id: treat.id, eaten: true }]);
  });

  test('dispose clears everything without crumbs', () => {
    const { treats, view } = setup();
    treats.spawn(100, 0);
    treats.dispose();
    assert.equal(treats.count, 0);
    assert.equal(view.removed[0].eaten, false);
  });
});
