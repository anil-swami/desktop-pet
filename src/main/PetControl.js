// Paused and hidden: the two states the tray, the pet menu and the pet page
// all need to agree on, so they live here in the main process.
//
//   paused  Pip naps and does nothing (no autonomy, reactions or bubbles)
//   hidden  the pet window is hidden, which also pauses it
//
// The pet page is told whenever the effective state changes, and asks for it
// on start-up (GET_CONTEXT), so a page reload can't lose it.

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class PetControl {
  #windowManager;
  #sendToPet;
  #log;
  #listeners = new Set();
  #paused = false;
  #hidden = false;

  constructor({ windowManager, sendToPet, log = silentLog }) {
    this.#windowManager = windowManager;
    this.#sendToPet = sendToPet;
    this.#log = log;
  }

  get paused() {
    return this.#paused;
  }

  get hidden() {
    return this.#hidden;
  }

  // What the pet page should do: rest if paused or hidden.
  get resting() {
    return this.#paused || this.#hidden;
  }

  pause() {
    if (this.#paused) return;
    this.#paused = true;
    this.#log.info('Pet paused');
    this.#changed();
  }

  resume() {
    if (!this.#paused) return;
    this.#paused = false;
    this.#log.info('Pet resumed');
    this.#changed();
  }

  hide() {
    if (this.#hidden) return;
    this.#hidden = true;
    this.#windowManager.hidePet();
    this.#log.info('Pet hidden');
    this.#changed();
  }

  // Also brings the pet in front of other windows (useful with "always on top" off).
  show() {
    const wasHidden = this.#hidden;
    this.#hidden = false;
    this.#windowManager.showPet();
    if (wasHidden) {
      this.#log.info('Pet shown');
      this.#changed();
    }
  }

  // listener({ paused, hidden, resting }). Returns an unsubscribe function.
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed() {
    const state = { paused: this.#paused, hidden: this.#hidden, resting: this.resting };
    this.#sendToPet({ type: 'pause', paused: state.resting });
    for (const listener of this.#listeners) listener(state);
  }
}
