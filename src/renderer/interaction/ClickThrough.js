// Keeps the transparent pet window click-through everywhere except the pet.
//
// The window ignores the mouse by default but still receives mousemove events
// (forwarded by the main process). When the cursor is over the pet we ask main
// to accept clicks; when it leaves, clicks pass through again. IPC is only
// sent when that state flips, not on every mouse move.
//
// Because the pet moves, it can also walk out from under a still cursor. No
// mousemove fires then, and the empty spot would keep swallowing clicks. So
// while the cursor is over the pet, we re-check each frame what is under the
// last known cursor position.
//
// hold() keeps the window accepting the mouse regardless of hover, e.g. while
// the pet is being dragged and the cursor races ahead of it.

export class ClickThrough {
  #target;
  #api;
  #ticker;
  #over = false;
  #holds = 0;
  #interactive = false;
  #pointer = null;
  #stopWatching = null;

  constructor({ target, api, ticker }) {
    this.#target = target;
    this.#api = api;
    this.#ticker = ticker;

    document.addEventListener('mousemove', (event) => {
      this.#pointer = { x: event.clientX, y: event.clientY };
      this.#setOver(target.contains(event.target));
    });
    document.addEventListener('mouseleave', () => {
      this.#pointer = null;
      this.#setOver(false);
    });
    window.addEventListener('blur', () => this.#setOver(false));
  }

  // Returns a release function (safe to call more than once).
  hold() {
    this.#holds += 1;
    this.#apply();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holds -= 1;
      this.#recheck();
      this.#apply();
    };
  }

  #setOver(over) {
    if (over === this.#over) return;
    this.#over = over;
    if (over) {
      this.#stopWatching = this.#ticker.add(this.#recheck);
    } else {
      this.#stopWatching?.();
      this.#stopWatching = null;
    }
    this.#apply();
  }

  #apply() {
    const interactive = this.#over || this.#holds > 0;
    if (interactive === this.#interactive) return;
    this.#interactive = interactive;
    this.#api?.setClickThrough(!interactive);
  }

  #recheck = () => {
    if (!this.#pointer) return;
    const element = document.elementFromPoint(this.#pointer.x, this.#pointer.y);
    this.#setOver(this.#target.contains(element));
  };
}
