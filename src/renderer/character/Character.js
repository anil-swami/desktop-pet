// The pet as the rest of the app sees it.
//
//   Character
//    ├── Animation  -> AnimationController (what is playing, frame timing)
//    ├── Direction  -> left / right (art is mirrored for the other side)
//    ├── Position   -> Phase 3 (MovementController)
//    └── Behavior   -> Phase 8 (state machine decides what to play)
//
// For now the current animation doubles as the pet's "state". Small life
// details that belong to the character itself, like blinking while idle,
// live here rather than in the behavior engine.

import { AnimationController } from './AnimationController.js';

const BLINK_DELAY_MS = { min: 2500, max: 6500 };
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class Character {
  #animations;
  #controller;
  #ticker;
  #log;
  #random;
  #cancelBlink = null;
  #previous = null;

  constructor({ data, view, ticker, log = silentLog, random = Math.random }) {
    this.name = data.name;
    this.#animations = data.animations;
    this.#ticker = ticker;
    this.#log = log;
    this.#random = random;
    this.#controller = new AnimationController({
      animations: data.animations,
      facing: data.facing,
      view,
      ticker,
      onChange: (name) => this.#onAnimationChange(name),
    });
  }

  get animation() {
    return this.#controller.current;
  }

  get direction() {
    return this.#controller.direction;
  }

  get animationNames() {
    return Object.keys(this.#animations);
  }

  play(name, options) {
    if (!this.#controller.has(name)) {
      this.#log.warn(`Unknown animation "${name}"`);
      return Promise.resolve(false);
    }
    return this.#controller.play(name, options);
  }

  face(direction) {
    if (this.#controller.setDirection(direction)) this.#log.debug(`Direction: ${direction}`);
  }

  turnAround() {
    this.face(this.direction === 'left' ? 'right' : 'left');
  }

  dispose() {
    this.#cancelBlink?.();
    this.#controller.dispose();
  }

  #onAnimationChange(name) {
    // Blinks happen every few seconds; keep them (and the idle after them) out of the log.
    const routineBlink = name === 'blink' || (name === 'idle' && this.#previous === 'blink');
    this.#previous = name;
    if (!routineBlink) {
      const { aliasOf } = this.#animations[name];
      this.#log.debug(`Animation: ${name}-${this.direction}${aliasOf ? ` (using ${aliasOf} frames)` : ''}`);
    }

    this.#cancelBlink?.();
    this.#cancelBlink = null;
    if (name === 'idle' && this.#animations.blink && !this.#animations.blink.aliasOf) {
      const delay = BLINK_DELAY_MS.min + this.#random() * (BLINK_DELAY_MS.max - BLINK_DELAY_MS.min);
      this.#cancelBlink = this.#ticker.after(delay, () => {
        this.#cancelBlink = null;
        this.play('blink'); // blink's `next` returns to idle, which schedules the next blink
      });
    }
  }
}
