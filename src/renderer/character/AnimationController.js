// Plays frame-based animations: decides WHICH frame to show and WHEN.
//
// It never touches the DOM. It tells a `view` what to draw:
//   view.setAnimation(name, motion)   when the animation changes
//   view.showFrame(src, mirrored)     when the visible frame changes
// That split keeps timing logic testable in plain Node with a fake view.
//
// play() returns a Promise:
//   true  -> a one-shot animation finished
//   false -> it was interrupted by another play() (or the animation is unknown)
// Looping animations only settle when replaced. This lets future behaviors
// write `await character.play('jump')`.

export class AnimationController {
  #animations;
  #facing;
  #view;
  #ticker;
  #onChange;

  #name = null;
  #animation = null;
  #frameIndex = 0;
  #elapsed = 0;
  #direction;
  #speed = 1; // 2 = frames advance twice as fast (settings: Animation speed)
  #unsubscribe = null;
  #pending = null; // { promise, resolve } for the current play() call

  constructor({ animations, facing = 'right', view, ticker, onChange = () => {} }) {
    this.#animations = animations;
    this.#facing = facing;
    this.#direction = facing;
    this.#view = view;
    this.#ticker = ticker;
    this.#onChange = onChange;
  }

  get current() {
    return this.#name;
  }

  get direction() {
    return this.#direction;
  }

  has(name) {
    return Object.hasOwn(this.#animations, name);
  }

  play(name, { restart = false } = {}) {
    if (!this.has(name)) return Promise.resolve(false);
    // Asking for what is already playing is a no-op, so callers can safely
    // request "walk" every frame without restarting it.
    if (name === this.#name && this.#pending && !restart) return this.#pending.promise;

    this.#settle(false);
    this.#name = name;
    this.#animation = this.#animations[name];
    this.#frameIndex = 0;
    this.#elapsed = 0;

    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.#pending = { promise, resolve };

    this.#view.setAnimation(name, this.#animation.motion);
    this.#render();
    this.#updateTicking();
    this.#onChange(name);
    return promise;
  }

  setSpeed(speed) {
    this.#speed = Math.min(4, Math.max(0.25, Number(speed) || 1));
  }

  // Returns true if the direction actually changed.
  setDirection(direction) {
    if ((direction !== 'left' && direction !== 'right') || direction === this.#direction) return false;
    this.#direction = direction;
    if (this.#animation) this.#render();
    return true;
  }

  // Advance by dt milliseconds. Called by the Ticker, or directly in tests.
  update(dt) {
    const animation = this.#animation;
    if (!animation) return;

    this.#elapsed += dt * this.#speed;
    let changed = false;

    while (this.#elapsed >= animation.frames[this.#frameIndex].ms) {
      this.#elapsed -= animation.frames[this.#frameIndex].ms;

      if (this.#frameIndex < animation.frames.length - 1) {
        this.#frameIndex += 1;
        changed = true;
      } else if (animation.loop) {
        if (animation.frames.length === 1) { this.#elapsed = 0; break; }
        this.#frameIndex = 0;
        changed = true;
      } else {
        if (changed) this.#render(); // the held last frame must actually be drawn
        this.#finish();
        return;
      }
    }
    if (changed) this.#render();
  }

  dispose() {
    this.#stopTicking();
    this.#settle(false);
  }

  #finish() {
    const { next } = this.#animation;
    this.#stopTicking();
    this.#settle(true); // the last frame stays on screen unless `next` takes over
    if (next) this.play(next);
  }

  #render() {
    const frame = this.#animation.frames[this.#frameIndex];
    this.#view.showFrame(frame.src, this.#direction !== this.#facing);
  }

  // A still, looping pose (one frame) needs no per-frame updates at all.
  #updateTicking() {
    const needsTicks = this.#animation.frames.length > 1 || !this.#animation.loop;
    if (needsTicks && !this.#unsubscribe) this.#unsubscribe = this.#ticker.add((dt) => this.update(dt));
    else if (!needsTicks) this.#stopTicking();
  }

  #stopTicking() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #settle(finished) {
    this.#pending?.resolve(finished);
    this.#pending = null;
  }
}
