// Is the user at the computer? Used so the pet naps while you're away and
// wakes up when you're back.
//
// Uses Electron's powerMonitor: the system idle time (seconds since the last
// keyboard/mouse input anywhere — just a number, no keys are seen) plus lock /
// unlock / sleep events. Polls every 15 s, which costs next to nothing.

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class UserPresence {
  #powerMonitor;
  #onChange;
  #log;
  #idleSeconds;
  #pollMs;
  #timer = null;
  #away = false;
  #subscriptions = [];

  constructor({ powerMonitor, onChange, log = silentLog, idleSeconds = 300, pollMs = 15_000 }) {
    this.#powerMonitor = powerMonitor;
    this.#onChange = onChange;
    this.#log = log;
    this.#idleSeconds = idleSeconds;
    this.#pollMs = pollMs;
  }

  get away() {
    return this.#away;
  }

  start() {
    this.#timer = setInterval(() => this.check(), this.#pollMs);
    this.#subscribe('lock-screen', () => this.#set(true, 'screen locked'));
    this.#subscribe('unlock-screen', () => this.#set(false, 'screen unlocked'));
    this.#subscribe('suspend', () => this.#set(true, 'going to sleep'));
    this.#subscribe('resume', () => this.check());
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    for (const [event, listener] of this.#subscriptions) this.#powerMonitor.removeListener(event, listener);
    this.#subscriptions = [];
  }

  check() {
    const idle = this.#powerMonitor.getSystemIdleTime();
    this.#set(idle >= this.#idleSeconds, idle >= this.#idleSeconds ? `no input for ${Math.round(idle / 60)} min` : 'input again');
  }

  #subscribe(event, listener) {
    this.#powerMonitor.on(event, listener);
    this.#subscriptions.push([event, listener]);
  }

  #set(away, reason) {
    if (away === this.#away) return;
    this.#away = away;
    this.#log.info(`User ${away ? 'away' : 'back'} (${reason})`);
    this.#onChange(away);
  }
}
