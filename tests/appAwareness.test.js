import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppAwareness, classifyForeground } from '../src/main/AppAwareness.js';

describe('classifyForeground', () => {
  test('groups known apps into categories', () => {
    assert.equal(classifyForeground({ kind: 'app', process: 'Code.exe' }).category, 'code');
    assert.equal(classifyForeground({ kind: 'app', process: 'chrome.exe' }).category, 'browser');
    assert.equal(classifyForeground({ kind: 'app', process: 'WhatsApp.Root.exe' }).category, 'chat');
    assert.equal(classifyForeground({ kind: 'app', process: 'SomeGame.exe' }).category, 'other');
    assert.equal(classifyForeground({ kind: 'app', process: 'Code.exe' }).app, 'code');
  });

  test('recognises the desktop and folder windows', () => {
    assert.equal(classifyForeground({ kind: 'desktop', process: 'explorer.exe' }).category, 'desktop');
    assert.equal(classifyForeground({ kind: 'folder', process: 'explorer.exe' }).category, 'folder');
  });

  test('ignores the taskbar, the pet itself, and nothing at all', () => {
    assert.equal(classifyForeground({ kind: 'taskbar', process: 'explorer.exe' }), null);
    assert.equal(classifyForeground({ kind: 'self', process: 'electron.exe' }), null);
    assert.equal(classifyForeground({ kind: 'none' }), null);
    assert.equal(classifyForeground({ kind: 'app', process: '' }), null);
    assert.equal(classifyForeground(null), null);
  });

  test('keeps the maximized and fullscreen flags', () => {
    const info = classifyForeground({ kind: 'app', process: 'vlc.exe', maximized: false, fullscreen: true });
    assert.deepEqual([info.category, info.maximized, info.fullscreen], ['media', false, true]);
  });
});

function setup() {
  const listeners = [];
  const helper = {
    available: true,
    unavailableReason: null,
    watched: 0,
    unwatched: 0,
    async watch(listener) { this.watched += 1; listeners.push(listener); },
    async unwatch() { this.unwatched += 1; },
  };
  const changes = [];
  const awareness = new AppAwareness({ helper, onChange: (info) => changes.push(info), debounceMs: 5 });
  const emit = (data) => listeners.at(-1)('foreground', data);
  return { awareness, helper, changes, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('AppAwareness', () => {
  test('reports a switch once things settle, without window ids', async () => {
    const { awareness, changes, emit } = setup();
    await awareness.setEnabled(true);
    emit({ kind: 'app', process: 'chrome.exe', window: 1 });
    emit({ kind: 'app', process: 'Code.exe', window: 2, maximized: true }); // Alt+Tab passing by chrome
    await settle();
    assert.deepEqual(changes, [{ category: 'code', app: 'code', maximized: true, fullscreen: false, newFolder: false }]);
    assert.deepEqual(awareness.current, { category: 'code', app: 'code', maximized: true, fullscreen: false });
  });

  test('ignores repeats of the same window', async () => {
    const { awareness, changes, emit } = setup();
    await awareness.setEnabled(true);
    emit({ kind: 'app', process: 'Code.exe', window: 2 });
    await settle();
    emit({ kind: 'taskbar', process: 'explorer.exe', window: 9 }); // clicking the taskbar
    emit({ kind: 'app', process: 'Code.exe', window: 2 });
    await settle();
    assert.equal(changes.length, 1);
  });

  test('flags folder windows the first time they appear', async () => {
    const { awareness, changes, emit } = setup();
    await awareness.setEnabled(true);
    emit({ kind: 'folder', window: 5 });
    await settle();
    emit({ kind: 'app', process: 'Code.exe', window: 2 });
    await settle();
    emit({ kind: 'folder', window: 5 }); // back to the same folder window
    await settle();
    assert.deepEqual(changes.filter((c) => c.category === 'folder').map((c) => c.newFolder), [true, false]);
  });

  test('switching off stops watching and forgets the current app', async () => {
    const { awareness, helper, emit } = setup();
    await awareness.setEnabled(true);
    emit({ kind: 'app', process: 'Code.exe', window: 2 });
    await settle();
    await awareness.setEnabled(false);
    assert.equal(helper.unwatched, 1);
    assert.equal(awareness.current, null);
  });

  test('does nothing when the helper is unavailable', async () => {
    const { awareness, helper } = setup();
    helper.available = false;
    helper.unavailableReason = 'blocked';
    await awareness.setEnabled(true);
    assert.equal(helper.watched, 0);
  });
});
