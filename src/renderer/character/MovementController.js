// Moves the pet around the pet window: walking, running, jumping and gravity.
//
// Coordinates are CSS pixels inside the pet window, which covers the work area:
//   x = horizontal centre of the pet
//   y = where its feet are (grows downward, like screen coordinates)
// The ground is the bottom of the window, i.e. the top of the taskbar.
//
// Physics is simple per-frame integration:
//   velocity += gravity * dt
//   position += velocity * dt
//
// Rendering is a CSS transform on the pet (via the view): no Electron window
// is moved, ever. The Ticker only runs while the pet is actually moving.
//
// The `animator` (the Character) is told what to show on movement
// TRANSITIONS only (start, stop, jump, land, arrive), never every frame.

export const MOVEMENT_DEFAULTS = Object.freeze({
  walkSpeed: 60,   // px per second
  runSpeed: 190,   // px per second
  gravity: 2400,   // px per second²
  jumpSpeed: 600,  // initial upward speed; peak height = jumpSpeed² / (2 × gravity) ≈ 75 px
});

const ARRIVE_EPSILON = 0.5;
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class MovementController {
  #animator;
  #view;
  #ticker;
  #log;
  #options;
  #halfWidth;
  #area;

  #x;
  #y;
  #vy = 0;
  #mode = 'idle'; // horizontal intent: idle | walk | run
  #grounded = true;
  #jumping = false;
  #target = null; // { x, resolve } while moveTo() is in progress
  #landingWaiters = [];
  #unsubscribe = null;

  constructor({ animator, view, ticker, size, area, log = silentLog, options = {} }) {
    this.#animator = animator;
    this.#view = view;
    this.#ticker = ticker;
    this.#log = log;
    this.#options = { ...MOVEMENT_DEFAULTS, ...options };
    this.#halfWidth = size.width / 2;
    this.#area = { width: area.width, height: area.height };
    this.#x = area.width / 2;
    this.#y = area.height;
  }

  get position() {
    return { x: this.#x, y: this.#y };
  }

  get mode() {
    return this.#mode;
  }

  get grounded() {
    return this.#grounded;
  }

  get isMoving() {
    return this.#mode !== 'idle' || !this.#grounded;
  }

  // Teleport (clamped to the area). Above the ground, the pet falls.
  placeAt(x, y = this.#ground) {
    this.#settleTarget(false);
    this.#settleLanding(false);
    this.#mode = 'idle';
    this.#x = this.#clampX(x);
    this.#y = Math.min(y, this.#ground);
    this.#vy = 0;
    this.#jumping = false;
    this.#grounded = this.#y >= this.#ground;
    this.#log.debug(`Placed at ${this.#where()}`);
    this.#render();
    this.#syncAnimation();
    this.#updateTicking();
  }

  walk(direction) {
    this.#startMoving('walk', direction);
  }

  run(direction) {
    this.#startMoving('run', direction);
  }

  stop() {
    this.#settleTarget(false);
    if (this.#mode === 'idle') return;
    this.#mode = 'idle';
    this.#log.debug(`Stopped at ${this.#where()}`);
    this.#syncAnimation();
    this.#updateTicking();
  }

  turnAround() {
    this.#settleTarget(false);
    this.#animator.face(this.#animator.direction === 'left' ? 'right' : 'left');
  }

  // Walk (or run) to x. Resolves true on arrival, false if interrupted.
  moveTo(x, { run = false, label = null } = {}) {
    this.#settleTarget(false);
    const targetX = this.#clampX(x);
    if (Math.abs(targetX - this.#x) <= ARRIVE_EPSILON) {
      this.stop();
      return Promise.resolve(true);
    }
    this.#log.debug(`Target: ${label ? `${label} ` : ''}x=${Math.round(targetX)}`);
    return new Promise((resolve) => {
      this.#target = { x: targetX, resolve };
      this.#setMotion(run ? 'run' : 'walk', targetX > this.#x ? 'right' : 'left');
    });
  }

  // Resolves true when the pet lands, false if it could not jump (already airborne).
  jump() {
    if (!this.#grounded) return Promise.resolve(false);
    this.#grounded = false;
    this.#jumping = true;
    this.#vy = -this.#options.jumpSpeed;
    this.#log.debug(`Jump from ${this.#where()}`);
    this.#syncAnimation();
    this.#updateTicking();
    return new Promise((resolve) => this.#landingWaiters.push(resolve));
  }

  // The usable space changed (e.g. resolution or taskbar change).
  setArea({ width, height }) {
    this.#area = { width, height };
    this.#x = this.#clampX(this.#x);
    if (this.#target) this.#target.x = this.#clampX(this.#target.x);
    if (this.#y > this.#ground) this.#y = this.#ground;
    this.#render();
    if (this.#grounded && this.#y < this.#ground) {
      // The ground dropped away beneath a standing pet (e.g. taskbar auto-hid): fall.
      this.#grounded = false;
      this.#jumping = false;
      this.#vy = 0;
      this.#syncAnimation();
    }
    this.#updateTicking();
  }

  // Advance by dt milliseconds. Called by the Ticker, or directly in tests.
  update(dt) {
    const seconds = dt / 1000;
    let arrived = false;
    let hitEdge = false;
    let landed = false;

    if (this.#mode !== 'idle') {
      if (this.#target) {
        // Always head for the target, even if something turned the pet around.
        const needed = this.#target.x > this.#x ? 'right' : 'left';
        if (this.#animator.direction !== needed) this.#animator.face(needed);
      }
      const speed = this.#mode === 'run' ? this.#options.runSpeed : this.#options.walkSpeed;
      const step = speed * seconds;
      let nextX = this.#x + (this.#animator.direction === 'right' ? step : -step);

      if (this.#target && Math.abs(this.#target.x - this.#x) <= step) {
        nextX = this.#target.x;
        arrived = true;
      }
      const clamped = this.#clampX(nextX);
      hitEdge = !arrived && clamped !== nextX;
      this.#x = clamped;
    }

    if (!this.#grounded) {
      this.#vy += this.#options.gravity * seconds;
      this.#y += this.#vy * seconds;
      if (this.#y >= this.#ground) {
        this.#y = this.#ground;
        this.#vy = 0;
        this.#grounded = true;
        this.#jumping = false;
        landed = true;
      }
    }

    this.#render();

    if (arrived) {
      this.#mode = 'idle';
      this.#log.debug(`Arrived at ${this.#where()}`);
      this.#settleTarget(true);
    } else if (hitEdge) {
      this.#mode = 'idle';
      this.#log.debug(`Reached the ${this.#x <= this.#halfWidth ? 'left' : 'right'} edge at ${this.#where()}`);
    }
    if (landed) {
      this.#log.debug(`Landed at ${this.#where()}`);
      this.#settleLanding(true);
    }
    if (arrived || hitEdge || landed) this.#syncAnimation();
    this.#updateTicking();
  }

  dispose() {
    this.#stopTicking();
    this.#settleTarget(false);
    this.#settleLanding(false);
  }

  get #ground() {
    return this.#area.height;
  }

  #startMoving(mode, direction) {
    if (direction !== 'left' && direction !== 'right') return;
    this.#settleTarget(false);
    this.#setMotion(mode, direction);
  }

  #setMotion(mode, direction) {
    const modeChanged = mode !== this.#mode;
    this.#mode = mode;
    this.#animator.face(direction);
    if (modeChanged) this.#syncAnimation();
    this.#updateTicking();
  }

  // Pick the animation that matches the current movement state.
  #syncAnimation() {
    let name = 'idle';
    if (!this.#grounded) name = this.#jumping ? 'jump' : 'fall';
    else if (this.#mode !== 'idle') name = this.#mode;
    this.#animator.play(name);
  }

  #render() {
    this.#view.setPosition(this.#x, this.#y);
  }

  #clampX(x) {
    const max = Math.max(this.#halfWidth, this.#area.width - this.#halfWidth);
    return Math.min(Math.max(x, this.#halfWidth), max);
  }

  #updateTicking() {
    if (this.isMoving && !this.#unsubscribe) this.#unsubscribe = this.#ticker.add((dt) => this.update(dt));
    else if (!this.isMoving) this.#stopTicking();
  }

  #stopTicking() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #settleTarget(arrived) {
    const target = this.#target;
    this.#target = null;
    target?.resolve(arrived);
  }

  #settleLanding(landed) {
    const waiters = this.#landingWaiters;
    this.#landingWaiters = [];
    for (const resolve of waiters) resolve(landed);
  }

  #where() {
    return `(${Math.round(this.#x)}, ${Math.round(this.#y)})`;
  }
}
