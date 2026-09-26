// Runs helpers/windows-helper.ps1 as a child process and talks to it in JSON
// lines: {"id":1,"command":"desktop-icons"} in, {"id":1,"ok":true,"result":...} out.
//
// - Started on first use (compiling its C# takes ~1-2 s once), then each
//   request is fast.
// - Stopped after a quiet period to free memory; restarted on the next request.
// - If it cannot start at all (PowerShell missing or locked down by policy),
//   the feature is marked unavailable instead of retrying forever.
//
// Only the fixed command names below are ever sent; nothing from the renderer
// is passed to PowerShell.

import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_SCRIPT = path.join(import.meta.dirname, 'helpers', 'windows-helper.ps1');
// Full path, so a different "powershell.exe" earlier in PATH can't be picked up.
const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const COMMANDS = new Set(['desktop-icons', 'ping']);
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class WindowsHelper {
  #spawn;
  #script;
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

  constructor({
    petPid,
    log = silentLog,
    spawn = nodeSpawn,
    script = DEFAULT_SCRIPT,
    idleMs = 120_000,
    timeoutMs = 20_000,
    platform = process.platform,
  }) {
    this.#petPid = petPid;
    this.#log = log;
    this.#spawn = spawn;
    this.#script = script;
    this.#idleMs = idleMs;
    this.#timeoutMs = timeoutMs;
    this.#platform = platform;
  }

  get available() {
    return this.#platform === 'win32' && this.#unavailableReason === null;
  }

  get unavailableReason() {
    return this.#platform === 'win32' ? this.#unavailableReason : 'only available on Windows';
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

    const child = this.#spawn(POWERSHELL, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta',
      '-File', this.#script, '-PetPid', String(this.#petPid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => this.#log.warn(`Windows helper: ${String(text).trim().slice(0, 300)}`));
    child.stdin.on('error', () => {}); // writing to a dead helper: 'exit' handles the cleanup
    child.on('error', (err) => this.#onExit(child, null, err));
    child.on('exit', (code) => this.#onExit(child, code));
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
      // Never got going (no PowerShell, blocked by policy...): don't keep retrying.
      this.#unavailableReason = err ? err.message : `exited during startup (code ${code})`;
      this.#log.warn(`Windows helper unavailable: ${this.#unavailableReason}`);
    } else if (err || code) {
      this.#log.warn(`Windows helper exited unexpectedly (${err ? err.message : `code ${code}`}); it will restart on the next request`);
    }
    this.#rejectAll(new Error('Windows helper exited'));
  }

  #scheduleIdleStop() {
    clearTimeout(this.#idleTimer);
    if (this.#pending.size > 0 || !this.#child) return;
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
