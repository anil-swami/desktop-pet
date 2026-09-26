// Treats you can give the pet ("Feed" in the menu).
//
// A treat is dropped near the pet, falls to the floor with gravity, and waits
// there until the pet eats it. Logic only: a `view` draws it
// (add / move / remove), so this can be unit-tested without a browser.
//
// If the pet is interrupted on its way to a treat, the treat stays on the floor,
// and the pet's "eat-leftovers" activity goes back for it later.

const GRAVITY = 2400; // px/s², same feel as the pet
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class Treats {
  #view;
  #ticker;
  #getFloorY;
  #max;
  #log;
  #items = [];
  #nextId = 1;
  #unsubscribe = null;

  constructor({ view, ticker, getFloorY, max = 3, log = silentLog }) {
    this.#view = view;
    this.#ticker = ticker;
    this.#getFloorY = getFloorY;
    this.#max = max;
    this.#log = log;
  }

  get count() {
    return this.#items.length;
  }

  has(treat) {
    return this.#items.includes(treat);
  }

  // Drop a treat at (x, y). Returns it, or null if there are already enough.
  spawn(x, y) {
    if (this.#items.length >= this.#max) return null;
    const treat = { id: this.#nextId++, x, y: Math.min(y, this.#getFloorY()), vy: 0, landed: false, waiters: [] };
    this.#items.push(treat);
    this.#view.add(treat);
    this.#log.debug(`Treat dropped at x=${Math.round(x)}`);
    if (!this.#unsubscribe) this.#unsubscribe = this.#ticker.add((dt) => this.update(dt));
    return treat;
  }

  // The treat closest to x (landed or still falling), or null.
  nearest(x) {
    let best = null;
    for (const treat of this.#items) {
      if (!best || Math.abs(treat.x - x) < Math.abs(best.x - x)) best = treat;
    }
    return best;
  }

  whenLanded(treat) {
    if (treat.landed || !this.has(treat)) return Promise.resolve(this.has(treat));
    return new Promise((resolve) => treat.waiters.push(resolve));
  }

  eat(treat) {
    const index = this.#items.indexOf(treat);
    if (index === -1) return false;
    this.#items.splice(index, 1);
    this.#view.remove(treat, { eaten: true });
    return true;
  }

  // Advance falling treats by dt milliseconds. Called by the Ticker.
  update(dt) {
    const seconds = dt / 1000;
    const floor = this.#getFloorY();
    let falling = 0;
    for (const treat of this.#items) {
      if (treat.landed) continue;
      treat.y += treat.vy * seconds + 0.5 * GRAVITY * seconds * seconds;
      treat.vy += GRAVITY * seconds;
      if (treat.y >= floor) {
        treat.y = floor;
        treat.landed = true;
        for (const resolve of treat.waiters.splice(0)) resolve(true);
      } else {
        falling += 1;
      }
      this.#view.move(treat);
    }
    if (falling === 0) this.#stopTicking();
  }

  dispose() {
    this.#stopTicking();
    for (const treat of this.#items.splice(0)) this.#view.remove(treat, { eaten: false });
  }

  #stopTicking() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
