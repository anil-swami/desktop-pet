import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WindowsHelper } from '../src/main/WindowsHelper.js';

// Stop every helper after each test so no request timers outlive it.
const helpers = [];
afterEach(() => {
  for (const helper of helpers.splice(0)) helper.stop();
});
// For requests a test starts but doesn't await (stop() rejects them).
const ignore = (promise) => promise.catch(() => {});

// A stand-in for the PowerShell child process.
function fakeChild() {
  const child = new EventEmitter();
  child.written = [];
  child.killed = false;
  child.stdin = Object.assign(new EventEmitter(), {
    write: (text) => child.written.push(JSON.parse(text)),
    end() {},
  });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.kill = () => { child.killed = true; };
  child.send = (message) => child.stdout.emit('data', `${JSON.stringify(message)}\n`);
  return child;
}

function setup(options = {}) {
  const children = [];
  const spawnCalls = [];
  const helper = new WindowsHelper({
    petPid: 1234,
    platform: 'win32',
    spawn: (command, args, spawnOptions) => {
      spawnCalls.push({ command, args, spawnOptions });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    ...options,
  });
  helpers.push(helper);
  return { helper, children, spawnCalls };
}

describe('WindowsHelper', () => {
  test('starts PowerShell on first request, hidden, with the pet pid', () => {
    const { helper, spawnCalls } = setup();
    assert.equal(helper.running, false);
    ignore(helper.request('ping'));
    assert.equal(spawnCalls.length, 1);
    assert.match(spawnCalls[0].command, /powershell\.exe$/i);
    assert.ok(spawnCalls[0].args.includes('-NonInteractive'));
    assert.deepEqual(spawnCalls[0].args.slice(-2), ['-PetPid', '1234']);
    assert.equal(spawnCalls[0].spawnOptions.windowsHide, true);
  });

  test('matches answers to requests by id, even when split across chunks', async () => {
    const { helper, children } = setup();
    const first = helper.request('ping');
    const second = helper.request('desktop-icons');
    const [child] = children;
    assert.deepEqual(child.written.map((r) => r.command), ['ping', 'desktop-icons']);

    child.send({ ready: true });
    const answer = JSON.stringify({ id: child.written[1].id, ok: true, result: { Visible: true, Icons: [] } });
    child.stdout.emit('data', answer.slice(0, 10));
    child.stdout.emit('data', `${answer.slice(10)}\n${JSON.stringify({ id: child.written[0].id, ok: true, result: 'pong' })}\n`);
    assert.deepEqual(await second, { Visible: true, Icons: [] });
    assert.equal(await first, 'pong');
  });

  test('passes helper errors on as rejections', async () => {
    const { helper, children } = setup();
    const request = helper.request('desktop-icons');
    children[0].send({ id: children[0].written[0].id, ok: false, error: 'Desktop window not found' });
    await assert.rejects(request, /Desktop window not found/);
  });

  test('refuses commands it does not know', async () => {
    const { helper, spawnCalls } = setup();
    await assert.rejects(helper.request('delete-everything'), /Unknown helper command/);
    assert.equal(spawnCalls.length, 0);
  });

  test('a crash rejects pending requests; the next request restarts it', async () => {
    const { helper, children } = setup();
    const request = helper.request('ping');
    children[0].send({ ready: true });
    children[0].emit('exit', 1);
    await assert.rejects(request, /exited/);
    assert.equal(helper.available, true);
    ignore(helper.request('ping'));
    assert.equal(children.length, 2);
  });

  test('if it never starts, the feature is marked unavailable (no retry loop)', async () => {
    const { helper, children } = setup();
    const request = helper.request('ping');
    children[0].send({ ready: false, error: 'Cannot add type. Compilation is not allowed.' });
    children[0].emit('exit', 1);
    await assert.rejects(request);
    assert.equal(helper.available, false);
    assert.match(helper.unavailableReason, /Compilation is not allowed/);
    await assert.rejects(helper.request('ping'), /unavailable/);
    assert.equal(children.length, 1);
  });

  test('a missing PowerShell is reported as unavailable', async () => {
    const { helper, children } = setup();
    const request = helper.request('ping');
    children[0].emit('error', new Error('spawn powershell.exe ENOENT'));
    await assert.rejects(request);
    assert.match(helper.unavailableReason, /ENOENT/);
  });

  test('times out a request that gets no answer', async () => {
    const { helper } = setup({ timeoutMs: 10 });
    await assert.rejects(helper.request('ping'), /timed out/);
  });

  test('stops itself after being idle', async () => {
    const { helper, children } = setup({ idleMs: 10 });
    const request = helper.request('ping');
    children[0].send({ ready: true });
    children[0].send({ id: children[0].written[0].id, ok: true, result: 'pong' });
    await request;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(helper.running, false);
    assert.equal(children[0].killed, true);
  });

  test('is unavailable on other operating systems', async () => {
    const { helper } = setup({ platform: 'linux' });
    assert.equal(helper.available, false);
    await assert.rejects(helper.request('ping'), /only available on Windows/);
  });
});
