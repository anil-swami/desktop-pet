// The pet as the rest of the app sees it.
//
//   Character
//    ├── Animation  -> AnimationController (what is playing, frame timing)
//    ├── Direction  -> left / right (art is mirrored for the other side)
//    ├── Position   -> MovementController (walk, run, jump, gravity)
//    └── Behavior   -> Phase 8 (state machine decides what to do)
//
// For now the current animation doubles as the pet's "state". Small life
// details that belong to the character itself, like blinking while idle,
// live here rather than in the behavior engine.

import { AnimationController } from './AnimationController.js';
import { MovementController } from './MovementController.js';

const BLINK_DELAY_MS = { min: 2500, max: 6500 };
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class Character {
  #animations;
  #controller;
  #movement;
  #ticker;
  #log;
  #random;
  #cancelBlink = null;
  #previous = null;

  // area: { width, height } of the space the pet lives in (the pet window).
  constructor({ data, view, ticker, area, log = silentLog, random = Math.random, movementOptions }) {
    this.name = data.name;
    this.size = Object.freeze({ width: data.width, height: data.height });
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
    // The Character itself is the movement's "animator": movement calls
    // play()/face() and reads `direction`, so there is one source of truth.
    this.#movement = new MovementController({
      animator: this,
      view,
      ticker,
      area,
      size: { width: data.width, height: data.height },
      log,
      options: movementOptions,
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

  get position() {
    return this.#movement.position;
  }

  get isMoving() {
    return this.#movement.isMoving;
  }

  // Movement state: 'idle' | 'walk' | 'run'.
  get mode() {
    return this.#movement.mode;
  }

  get grounded() {
    return this.#movement.grounded;
  }

  get held() {
    return this.#movement.held;
  }

  get hasTarget() {
    return this.#movement.hasTarget;
  }

  get walkableRange() {
    return this.#movement.walkableRange;
  }

  get lastFallHeight() {
    return this.#movement.lastFallHeight;
  }

  // --- Animation -------------------------------------------------------------

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

  // --- Movement (see MovementController) --------------------------------------

  walk(direction = this.direction) {
    this.#movement.walk(direction);
  }

  run(direction = this.direction) {
    this.#movement.run(direction);
  }

  stop() {
    this.#movement.stop();
  }

  turnAround() {
    this.#movement.turnAround();
  }

  moveTo(x, options) {
    return this.#movement.moveTo(x, options);
  }

  jump() {
    return this.#movement.jump();
  }

  placeAt(x, y) {
    this.#movement.placeAt(x, y);
  }

  setArea(area) {
    this.#movement.setArea(area);
  }

  grab() {
    this.#movement.grab();
  }

  dragTo(x, y) {
    this.#movement.dragTo(x, y);
  }

  release(velocity) {
    return this.#movement.release(velocity);
  }

  dispose() {
    this.#cancelBlink?.();
    this.#movement.dispose();
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
