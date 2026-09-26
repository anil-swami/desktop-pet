import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DisplayManager, isUsableRect } from '../src/main/DisplayManager.js';

const BOUNDS = { x: 0, y: 0, width: 1536, height: 864 };
const WORK_AREA = { x: 0, y: 0, width: 1536, height: 816 };

const makeDisplay = (overrides = {}) => ({ id: 1, scaleFactor: 1.25, bounds: BOUNDS, workArea: WORK_AREA, ...overrides });

function fakeScreen(display) {
  const screen = new EventEmitter();
  screen.display = display;
  screen.fail = false;
  screen.getPrimaryDisplay = () => {
    if (screen.fail) throw new Error('no display');
    return screen.display;
  };
  return screen;
}

function setup(initial = makeDisplay()) {
  const screen = fakeScreen(initial);
  const powerMonitor = new EventEmitter();
  const warnings = [];
  const log = { debug() {}, info() {}, warn: (m) => warnings.push(m), error: (m) => warnings.push(m) };
  const manager = new DisplayManager({ screen, powerMonitor, log, debounceMs: 5 });
  const changes = [];
  const info = manager.start((next) => changes.push(next));
  return { screen, powerMonitor, manager, changes, info, warnings };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const metricsChanged = (screen, ...changed) => screen.emit('display-metrics-changed', {}, screen.display, changed);

describe('DisplayManager', () => {
  test('starts with the primary display work area', () => {
    const { info, manager } = setup();
    assert.deepEqual(info.workArea, WORK_AREA);
    assert.equal(info.scaleFactor, 1.25);
    assert.equal(manager.current, info);
  });

  test('falls back to full bounds, then a default, when the work area is unusable', () => {
    const { info } = setup(makeDisplay({ workArea: { x: 0, y: 0, width: 0, height: 0 } }));
    assert.deepEqual(info.workArea, BOUNDS);

    const broken = setup(makeDisplay({ workArea: { x: 0, y: 0, width: 0, height: 0 }, bounds: { x: 0, y: 0, width: NaN, height: 5 } }));
    assert.deepEqual(broken.info.workArea, { x: 0, y: 0, width: 1280, height: 720 });
    assert.equal(broken.warnings.length, 1);
  });

  test('reports a changed work area once, after a burst of events settles', async () => {
    const { screen, changes } = setup();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 1536, height: 864 } }); // taskbar auto-hide
    metricsChanged(screen, 'workArea');
    metricsChanged(screen, 'workArea');
    metricsChanged(screen, 'bounds');
    assert.equal(changes.length, 0);
    await settle();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].workArea.height, 864);
  });

  test('treats a scaling change as a change', async () => {
    const { screen, changes } = setup();
    screen.display = makeDisplay({ scaleFactor: 1.5, workArea: { x: 0, y: 0, width: 1280, height: 680 } });
    metricsChanged(screen, 'scaleFactor', 'workArea', 'bounds');
    await settle();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].scaleFactor, 1.5);
  });

  test('ignores events that change nothing', async () => {
    const { screen, powerMonitor, changes } = setup();
    metricsChanged(screen, 'rotation');
    powerMonitor.emit('resume');
    await settle();
    assert.equal(changes.length, 0);
  });

  test('checks again after waking from sleep and when displays come or go', async () => {
    const { screen, powerMonitor, changes } = setup();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 1536, height: 800 } });
    powerMonitor.emit('resume');
    await settle();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 1536, height: 790 } });
    screen.emit('display-removed');
    await settle();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 1536, height: 780 } });
    screen.emit('display-added');
    await settle();
    assert.deepEqual(changes.map((c) => c.workArea.height), [800, 790, 780]);
  });

  test('keeps the current area while the display is temporarily unusable', async () => {
    const { screen, changes, warnings, manager } = setup();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 0, height: 0 } });
    metricsChanged(screen, 'workArea');
    await settle();
    assert.equal(changes.length, 0);
    assert.deepEqual(manager.current.workArea, WORK_AREA);
    assert.match(warnings[0], /not usable/);
  });

  test('survives the display API throwing', async () => {
    const { screen, changes, warnings } = setup();
    screen.fail = true;
    metricsChanged(screen, 'workArea');
    await settle();
    assert.equal(changes.length, 0);
    assert.ok(warnings.some((w) => /Cannot read the primary display/.test(w)));
  });

  test('stop() removes listeners and cancels a pending check', async () => {
    const { screen, powerMonitor, manager, changes } = setup();
    screen.display = makeDisplay({ workArea: { x: 0, y: 0, width: 1536, height: 700 } });
    metricsChanged(screen, 'workArea');
    manager.stop();
    await settle();
    assert.equal(changes.length, 0);
    assert.equal(screen.listenerCount('display-metrics-changed'), 0);
    assert.equal(powerMonitor.listenerCount('resume'), 0);
  });
});

describe('isUsableRect', () => {
  test('accepts real work areas and rejects empty or broken ones', () => {
    assert.equal(isUsableRect(WORK_AREA), true);
    assert.equal(isUsableRect({ x: -1536, y: 0, width: 1536, height: 816 }), true); // left of the primary
    assert.equal(isUsableRect({ x: 0, y: 0, width: 0, height: 816 }), false);
    assert.equal(isUsableRect({ x: 0, y: 0, width: 1536, height: Infinity }), false);
    assert.equal(isUsableRect(null), false);
  });
});
