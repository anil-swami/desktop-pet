// Runs build/windows-helper.exe (compiled from helpers/WindowsHelper.cs) as a
// child process and talks to it in JSON lines:
//   requests:  {"id":1,"command":"desktop-icons"}  ->  {"id":1,"ok":true,"result":...}
//   events:    {"event":"foreground","data":{...}}  (after "watch-foreground")
//
// - Started on first use (~0.2 s), then each request takes milliseconds.
// - Stopped after a quiet period to free memory, unless something is watching
//   for events; restarted (and re-subscribed) on demand or after a crash.
// - If it cannot start at all (not built, blocked by policy...), the features
//   that need it are marked unavailable instead of retrying forever.
//
// Only the fixed command names below are ever sent; nothing from the renderer
// is passed to the helper.

import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXECUTABLE = path.resolve(import.meta.dirname, '..', '..', 'build', 'windows-helper.exe');
const COMMANDS = new Set(['desktop-icons', 'watch-foreground', 'unwatch-foreground', 'ping']);
const MAX_RESTARTS_PER_MINUTE = 3;
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class WindowsHelper {
  #spawn;
  #executable;
  #exists;
  #petPid;
  #log;
  #idleMs;
  #timeoutMs;
  #platform;

  #child = null;
  #ready = false;
  #buffer = '';
  #nextId = 1;
  #pending = new Map(); // id -> { resolve, reject, timer }
  #idleTimer = null;
  #startedAt = 0;
  #unavailableReason = null;
  #watching = false;
  #onEvent = null;
  #restarts = []; // times of automatic restarts, to stop a crash loop

  constructor({
    petPid,
    log = silentLog,
    spawn = nodeSpawn,
    executable = DEFAULT_EXECUTABLE,
    exists = fs.existsSync,
    idleMs = 120_000,
    timeoutMs = 10_000,
    platform = process.platform,
  }) {
    this.#petPid = petPid;
    this.#log = log;
    this.#spawn = spawn;
    this.#executable = executable;
    this.#exists = exists;
    this.#idleMs = idleMs;
    this.#timeoutMs = timeoutMs;
    this.#platform = platform;
  }

  get available() {
    return this.unavailableReason === null;
  }

  get unavailableReason() {
    if (this.#platform !== 'win32') return 'only available on Windows';
    if (this.#unavailableReason) return this.#unavailableReason;
    if (!this.#exists(this.#executable)) return 'helper not built (run "npm start", which builds it)';
    return null;
  }

  get running() {
    return this.#child !== null;
  }

  request(command) {
    if (!COMMANDS.has(command)) return Promise.reject(new Error(`Unknown helper command "${command}"`));
    if (!this.available) return Promise.reject(new Error(`Windows helper unavailable: ${this.unavailableReason}`));

    this.#ensureStarted();
    clearTimeout(this.#idleTimer);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Windows helper timed out on "${command}"`));
        this.#scheduleIdleStop();
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  // Receive foreground-window events: listener(eventName, data).
  watch(listener) {
    this.#onEvent = listener;
    const done = this.request('watch-foreground');
    this.#watching = true; // set after: re-subscribing is only for later restarts
    return done;
  }

  unwatch() {
    this.#watching = false;
    this.#onEvent = null;
    if (!this.#child) return Promise.resolve();
    const done = this.request('unwatch-foreground').catch(() => {});
    this.#scheduleIdleStop();
    return done;
  }

  stop() {
    clearTimeout(this.#idleTimer);
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    this.#rejectAll(new Error('Windows helper stopped'));
    child.stdin.end(); // the helper exits when its input closes
    child.kill();
  }

  #ensureStarted() {
    if (this.#child) return;
    this.#ready = false;
    this.#buffer = '';
    this.#startedAt = Date.now();
    this.#log.info('Starting Windows helper');

    const child = this.#spawn(this.#executable, ['--pet-pid', String(this.#petPid)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => this.#log.warn(`Windows helper: ${String(text).trim().slice(0, 300)}`));
    child.stdin.on('error', () => {}); // writing to a dead helper: 'exit' handles the cleanup
    child.on('error', (err) => this.#onExit(child, null, err));
    child.on('exit', (code) => this.#onExit(child, code));

    // After a restart, pick the event subscription back up.
    if (this.#watching) {
      const id = this.#nextId++;
      const timer = setTimeout(() => this.#pending.delete(id), this.#timeoutMs);
      this.#pending.set(id, { resolve() {}, reject() {}, timer });
      child.stdin.write(`${JSON.stringify({ id, command: 'watch-foreground' })}\n`);
    }
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) this.#onMessage(line);
    }
  }

  #onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#log.warn(`Windows helper sent something unexpected: ${line.slice(0, 200)}`);
      return;
    }

    if ('event' in message) {
      if (this.#watching) this.#onEvent?.(message.event, message.data);
      return;
    }

    if ('ready' in message) {
      if (message.ready) {
        this.#ready = true;
        this.#log.info(`Windows helper ready in ${Date.now() - this.#startedAt} ms`);
      } else {
        this.#unavailableReason = String(message.error ?? 'failed to start').slice(0, 300);
        this.#log.warn(`Windows helper cannot run on this PC: ${this.#unavailableReason}`);
      }
      return;
    }

    const request = this.#pending.get(message.id);
    if (!request) return;
    this.#pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error ?? 'Windows helper request failed')));
    this.#scheduleIdleStop();
  }

  #onExit(child, code, err) {
    if (child !== this.#child) return;
    this.#child = null;
    clearTimeout(this.#idleTimer);
    if (!this.#ready && this.#unavailableReason === null) {
      // Never got going: don't keep retrying.
      this.#unavailableReason = err ? err.message : `exited during startup (code ${code})`;
      this.#log.warn(`Windows helper unavailable: ${this.#unavailableReason}`);
    } else if (err || code) {
      this.#log.warn(`Windows helper exited unexpectedly (${err ? err.message : `code ${code}`}); it will restart when needed`);
    }
    this.#rejectAll(new Error('Windows helper exited'));

    // Something is waiting for events: bring it back, unless it keeps crashing.
    if (!this.#watching || !this.available) return;
    const now = Date.now();
    this.#restarts = this.#restarts.filter((time) => now - time < 60_000);
    if (this.#restarts.length >= MAX_RESTARTS_PER_MINUTE) {
      this.#unavailableReason = 'kept crashing';
      this.#log.error('Windows helper keeps crashing; giving up until the app restarts');
      return;
    }
    this.#restarts.push(now);
    this.#ensureStarted();
  }

  #scheduleIdleStop() {
    clearTimeout(this.#idleTimer);
    if (this.#pending.size > 0 || !this.#child || this.#watching) return;
    this.#idleTimer = setTimeout(() => {
      this.#log.debug('Stopping idle Windows helper');
      this.stop();
    }, this.#idleMs);
    this.#idleTimer.unref?.(); // housekeeping only: never keep a process alive for it
  }

  #rejectAll(error) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
  }
}
