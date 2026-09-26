// The pet's single animation loop and timer registry.
//
// requestAnimationFrame (rAF) asks the browser to call us right before it paints
// the next frame (~60 times per second), and pauses automatically while the
// window is hidden. Each listener gets `dt`: milliseconds since the last frame.
// Using dt instead of assuming 16.7 ms keeps timing correct on any refresh rate.
//
// Efficiency: the loop only runs while something is subscribed. When the pet
// holds a still pose, no rAF is scheduled and the renderer's JS is idle.
//
// Timers go through `after()` so everything the pet schedules can be cleared
// in one place (dispose) — no stray timeouts firing after shutdown.

const MAX_DT = 100; // clamp: after sleep/hide, don't jump animations by minutes

export class Ticker {
  #listeners = new Set();
  #timers = new Set();
  #frameId = 0;
  #lastTime = 0;
  #requestFrame;
  #cancelFrame;
  #now;
  #onError;

  // Injectable for tests; defaults are the real browser APIs.
  constructor({
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
    now = () => performance.now(),
    onError = (err) => console.error('[Pet:renderer] Ticker listener failed:', err),
  } = {}) {
    this.#requestFrame = requestFrame;
    this.#cancelFrame = cancelFrame;
    this.#now = now;
    this.#onError = onError;
  }

  get running() {
    return this.#frameId !== 0;
  }

  // Subscribe to every frame. Returns an unsubscribe function.
  add(listener) {
    this.#listeners.add(listener);
    if (!this.#frameId) {
      this.#lastTime = this.#now();
      this.#frameId = this.#requestFrame(this.#frame);
    }
    return () => this.remove(listener);
  }

  remove(listener) {
    this.#listeners.delete(listener);
    if (this.#listeners.size === 0 && this.#frameId) {
      this.#cancelFrame(this.#frameId);
      this.#frameId = 0;
    }
  }

  // One-shot timer. Returns a cancel function.
  after(ms, callback) {
    const id = setTimeout(() => {
      this.#timers.delete(id);
      callback();
    }, ms);
    this.#timers.add(id);
    return () => {
      clearTimeout(id);
      this.#timers.delete(id);
    };
  }

  dispose() {
    if (this.#frameId) this.#cancelFrame(this.#frameId);
    this.#frameId = 0;
    this.#listeners.clear();
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
  }

  #frame = (time) => {
    this.#frameId = 0; // this frame is consumed; listeners may add/remove freely below
    const dt = Math.min(Math.max(time - this.#lastTime, 0), MAX_DT);
    this.#lastTime = time;

    for (const listener of this.#listeners) {
      try {
        listener(dt);
      } catch (err) {
        this.#onError(err); // one broken listener must not stop the whole loop
      }
    }

    if (this.#listeners.size && !this.#frameId) this.#frameId = this.#requestFrame(this.#frame);
  };
}
