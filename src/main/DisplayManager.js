// Tracks the screen the pet lives on and reports when it changes.
//
// The pet lives on the PRIMARY display's work area: the screen minus the
// taskbar. Walking between several monitors is intentionally not supported.
// But the display can still change while the pet runs (resolution, scaling,
// taskbar size or auto-hide, rotation, waking from sleep, a projector plugged
// in or out), so we re-read the primary display and report real changes.
//
// Electron's `screen` API measures in DIPs (device-independent pixels): at 125%
// scaling a 1920x1080 panel is 1536x864 DIPs. Window and page coordinates use
// DIPs too, so scaling is handled for us; scaleFactor is only informational.
//
// `screen` and `powerMonitor` are passed in rather than imported, so this
// module can be unit-tested with fakes.

const DEFAULT_DEBOUNCE_MS = 250;
const MIN_USABLE_SIZE = 200;
const FALLBACK_AREA = Object.freeze({ x: 0, y: 0, width: 1280, height: 720 });
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export function isUsableRect(rect) {
  return Boolean(rect)
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width >= MIN_USABLE_SIZE
    && rect.height >= MIN_USABLE_SIZE;
}

export function rectText({ x, y, width, height }) {
  return `${width}x${height} at (${x}, ${y})`;
}

export function describeDisplay(info) {
  return `Display ${info.id}: work area ${rectText(info.workArea)}, scale ${info.scaleFactor}`;
}

function sameDisplay(a, b) {
  return a.id === b.id
    && a.scaleFactor === b.scaleFactor
    && ['x', 'y', 'width', 'height'].every((key) => a.workArea[key] === b.workArea[key]);
}

export class DisplayManager {
  #screen;
  #powerMonitor;
  #log;
  #debounceMs;
  #current = null;
  #onChange = null;
  #timer = null;
  #pendingReasons = new Set();
  #subscriptions = [];

  constructor({ screen, powerMonitor, log = silentLog, debounceMs = DEFAULT_DEBOUNCE_MS }) {
    this.#screen = screen;
    this.#powerMonitor = powerMonitor;
    this.#log = log;
    this.#debounceMs = debounceMs;
  }

  get current() {
    return this.#current;
  }

  // Reads the display now and calls onChange(info) whenever it later changes.
  // Returns the initial { id, workArea, scaleFactor }. Call after app 'ready'.
  start(onChange) {
    this.#onChange = onChange;
    const info = this.#read();
    this.#current = info && isUsableRect(info.workArea) ? info : this.#fallback(info);

    this.#subscribe(this.#screen, 'display-metrics-changed', (_event, _display, changed = []) =>
      this.#schedule(changed.length ? changed.join('+') : 'metrics'));
    this.#subscribe(this.#screen, 'display-added', () => this.#schedule('display added'));
    this.#subscribe(this.#screen, 'display-removed', () => this.#schedule('display removed'));
    this.#subscribe(this.#powerMonitor, 'resume', () => this.#schedule('resumed from sleep'));
    return this.#current;
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
    for (const [emitter, event, listener] of this.#subscriptions) emitter.removeListener(event, listener);
    this.#subscriptions = [];
  }

  #subscribe(emitter, event, listener) {
    emitter.on(event, listener);
    this.#subscriptions.push([emitter, event, listener]);
  }

  // One change often fires several events in a row (e.g. scaling changes
  // bounds, workArea and scaleFactor). Wait until they stop, then check once.
  #schedule(reason) {
    this.#pendingReasons.add(reason);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#check(), this.#debounceMs);
  }

  #check() {
    this.#timer = null;
    const reasons = [...this.#pendingReasons].join(', ');
    this.#pendingReasons.clear();

    const next = this.#read();
    if (!next || !isUsableRect(next.workArea)) {
      // Mid-reconfiguration Windows can briefly report nonsense; the next event will fix it.
      this.#log.warn(`Display not usable right now (${reasons}); keeping ${rectText(this.#current.workArea)}`);
      return;
    }
    if (sameDisplay(next, this.#current)) {
      this.#log.debug(`Display checked (${reasons}): no change`);
      return;
    }
    this.#log.info(`Display changed (${reasons}). ${describeDisplay(next)}`);
    this.#current = next;
    this.#onChange?.(next);
  }

  #read() {
    try {
      const display = this.#screen.getPrimaryDisplay();
      return {
        id: display.id,
        workArea: { ...display.workArea },
        bounds: { ...display.bounds },
        scaleFactor: display.scaleFactor,
      };
    } catch (err) {
      this.#log.error(`Cannot read the primary display: ${err.message}`);
      return null;
    }
  }

  #fallback(info) {
    const area = info && isUsableRect(info.bounds) ? info.bounds : FALLBACK_AREA;
    this.#log.warn(`Primary display work area unavailable; using ${rectText(area)}`);
    return { id: info?.id ?? null, workArea: { ...area }, bounds: { ...area }, scaleFactor: info?.scaleFactor ?? 1 };
  }
}
