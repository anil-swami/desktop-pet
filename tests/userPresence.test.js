import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UserPresence } from '../src/main/UserPresence.js';

function setup() {
  const powerMonitor = Object.assign(new EventEmitter(), { idle: 0, getSystemIdleTime() { return this.idle; } });
  const changes = [];
  const presence = new UserPresence({ powerMonitor, onChange: (away) => changes.push(away), idleSeconds: 300, pollMs: 60_000 });
  presence.start();
  return { presence, powerMonitor, changes };
}

describe('UserPresence', () => {
  test('goes away after enough idle time and comes back on input', () => {
    const { presence, powerMonitor, changes } = setup();
    powerMonitor.idle = 120;
    presence.check();
    powerMonitor.idle = 301;
    presence.check();
    powerMonitor.idle = 400;
    presence.check(); // still away: no repeat
    powerMonitor.idle = 2;
    presence.check();
    assert.deepEqual(changes, [true, false]);
    presence.stop();
  });

  test('locking and unlocking the screen count immediately', () => {
    const { presence, powerMonitor, changes } = setup();
    powerMonitor.emit('lock-screen');
    assert.equal(presence.away, true);
    powerMonitor.emit('unlock-screen');
    assert.deepEqual(changes, [true, false]);
    presence.stop();
  });

  test('stop() removes its listeners', () => {
    const { presence, powerMonitor } = setup();
    presence.stop();
    assert.equal(powerMonitor.listenerCount('lock-screen'), 0);
    assert.equal(powerMonitor.listenerCount('resume'), 0);
  });
});
