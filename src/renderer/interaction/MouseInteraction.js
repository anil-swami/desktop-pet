// Mouse interaction: noticing the cursor, reacting to clicks, drag and drop.
//
// Where the data comes from: the pet window covers the work area, and the main
// process forwards mouse MOVES to it even while it is click-through. So the
// page knows where the cursor is anywhere above the taskbar. It never sees
// clicks meant for other apps, and positions are only kept in memory.
//
//   Mouse approaches ─▶ noticed (within noticeDistance) ─▶ looks toward it
//                                     │
//        mode decides: curious ─▶ startled by a fast dash (surprised)
//                      follow  ─▶ walks/runs underneath, jumps to reach it
//                      shy     ─▶ runs away when it gets close
//
// Thresholds, hysteresis (notice vs forget distance) and cooldowns keep the pet
// from reacting to every tiny movement.
//
// DOM wiring lives in attach(); the handle*() methods take plain numbers, so
// the logic can be tested without a browser.

export const MOUSE_MODES = Object.freeze(['off', 'curious', 'follow', 'shy']);

export const MOUSE_DEFAULTS = Object.freeze({
  noticeDistance: 220,       // px from the pet's centre: the cursor gets noticed
  forgetDistance: 300,       // ...and forgotten beyond this (gap = no flicker at the edge)
  closeDistance: 110,        // "very close": shy pets flee, fast cursors startle
  turnCooldownMs: 1200,      // look toward the cursor at most this often
  startleSpeed: 1800,        // px/s
  startleCooldownMs: 10000,
  fleeDistance: 260,
  fleeCooldownMs: 1500,
  followDeadZone: 40,        // close enough horizontally: stop following
  followRunDistance: 300,    // farther than this: run instead of walk
  reachHeight: 150,          // cursor this far above the head: jump to reach it
  reachJumpCooldownMs: 2500,
  dragThreshold: 5,          // px a press must move before it becomes a drag
  throwWindowMs: 100,        // recent movement used to compute the throw speed
  maxThrowSpeed: 1800,       // px/s
  bigFall: 220,              // px; landing after a bigger fall makes the pet dizzy
  pokeWindowMs: 2500,
  pokesForConfused: 4,
  moveEvaluateMs: 100,       // evaluate at most this often while the mouse moves
  evaluateEveryMs: 150,      // re-check this often while engaged, even if the mouse is still
});

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export class MouseInteraction {
  #character;
  #ticker;
  #log;
  #now;
  #options;
  #holdPointer;
  #onDragChange;
  #onInteract;

  #mode = 'curious';
  #pointer = null; // { x, y, time } — last known cursor position
  #speed = 0;      // smoothed cursor speed, px/s
  #lastEvaluate = -Infinity;
  #noticed = false;
  #lastTurn = -Infinity;
  #lastStartle = -Infinity;
  #lastFlee = -Infinity;
  #lastReachJump = -Infinity;
  #fleeing = false;

  #press = null;   // { x, y, offsetX, offsetY } while the button is down on the pet
  #dragging = false;
  #samples = [];
  #releasePointer = null;
  #resumeAfterDrop = null;
  #pokes = [];

  #interaction = 0;   // bumped by every click/grab/reaction; stale follow-ups check it
  #reaction = null;   // id of the reaction animation currently playing
  #stopEvaluating = null;
  #detach = null;

  constructor({
    character,
    ticker,
    log = silentLog,
    now = () => performance.now(),
    options = {},
    holdPointer = () => () => {},
    onDragChange = () => {},
    onInteract = () => {},
  }) {
    this.#character = character;
    this.#ticker = ticker;
    this.#log = log;
    this.#now = now;
    this.#options = { ...MOUSE_DEFAULTS, ...options };
    this.#holdPointer = holdPointer;
    this.#onDragChange = onDragChange;
    this.#onInteract = onInteract;
  }

  get mode() {
    return this.#mode;
  }

  get noticed() {
    return this.#noticed;
  }

  get dragging() {
    return this.#dragging;
  }

  // True while the mouse is in charge of the pet (pressed, dragged, reacting,
  // fleeing, or following): the autonomous behavior waits.
  get busy() {
    return this.#press !== null || this.#dragging || this.#reaction !== null || this.#fleeing || this.#mode === 'follow';
  }

  setMode(mode) {
    if (!MOUSE_MODES.includes(mode) || mode === this.#mode) return false;
    const wasFollowing = this.#mode === 'follow';
    this.#mode = mode;
    this.#log.info(`Mouse mode: ${mode}`);
    if (wasFollowing && this.#character.hasTarget) this.#character.stop();
    if (mode === 'off') this.#noticed = false;
    this.evaluate();
    return true;
  }

  // --- DOM wiring ------------------------------------------------------------

  attach(target) {
    const listeners = [
      [document, 'mousemove', (event) => this.handlePointerMove(event.clientX, event.clientY, event.timeStamp)],
      [target, 'pointerdown', (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        target.setPointerCapture(event.pointerId); // keep receiving events even off the pet
        this.handlePointerDown(event.clientX, event.clientY, event.timeStamp);
      }],
      [target, 'pointerup', (event) => this.handlePointerUp(event.clientX, event.clientY, event.timeStamp)],
      [target, 'pointercancel', () => this.handlePointerCancel()],
      [target, 'lostpointercapture', () => this.handlePointerCancel()],
    ];
    for (const [element, type, listener] of listeners) element.addEventListener(type, listener);
    this.#detach = () => {
      for (const [element, type, listener] of listeners) element.removeEventListener(type, listener);
    };
  }

  dispose() {
    this.#detach?.();
    this.#stopEvaluating?.();
    this.#releasePointer?.();
  }

  // --- Input (plain numbers: window coordinates and timestamps in ms) ----------

  handlePointerMove(x, y, time) {
    const previous = this.#pointer;
    this.#pointer = { x, y, time };
    if (previous) {
      const dt = time - previous.time;
      if (dt > 0) {
        const instant = (Math.hypot(x - previous.x, y - previous.y) / dt) * 1000;
        this.#speed = dt > 200 ? instant : this.#speed * 0.6 + instant * 0.4;
      }
    }
    if (this.#press) {
      this.#pressMove(x, y, time);
      return;
    }
    if (time - this.#lastEvaluate >= this.#options.moveEvaluateMs) this.evaluate(time);
  }

  handlePointerDown(x, y, time) {
    if (this.#press) return;
    this.#pointer = { x, y, time };
    this.#press = { x, y, offsetX: 0, offsetY: 0 };
    this.#releasePointer = this.#holdPointer();
    this.#onInteract('press');
  }

  handlePointerUp(x, y, time) {
    if (!this.#press) return;
    this.#press = null;
    if (this.#dragging) this.#drop(time);
    else this.#click(time);
    this.#releaseHold();
  }

  handlePointerCancel() {
    if (!this.#press) return;
    this.#press = null;
    if (this.#dragging) {
      this.#samples = [];
      this.#drop(this.#now());
    }
    this.#releaseHold();
  }

  // --- Proximity ---------------------------------------------------------------

  evaluate(time = this.#now()) {
    this.#lastEvaluate = time;
    if (this.#mode === 'off' || !this.#pointer) {
      this.#noticed = false;
      this.#updateEvaluating();
      return;
    }

    const { x: px, y: py } = this.#character.position;
    const dx = this.#pointer.x - px;
    const dy = this.#pointer.y - (py - this.#character.size.height / 2);
    const distance = Math.hypot(dx, dy);
    const speed = time - this.#pointer.time > 150 ? 0 : this.#speed; // stale speed = still cursor

    if (!this.#noticed && distance <= this.#options.noticeDistance) {
      this.#noticed = true;
      this.#log.debug(`Noticed the mouse ${Math.round(distance)}px away`);
    } else if (this.#noticed && distance > this.#options.forgetDistance) {
      this.#noticed = false;
      this.#log.debug('Lost interest in the mouse');
    }

    if (this.#isFree()) {
      const close = distance <= this.#options.closeDistance;
      if (this.#mode === 'follow') this.#follow(dx, time);
      else if (this.#noticed && this.#mode === 'shy' && close) this.#flee(dx, time);
      else if (this.#noticed && this.#mode === 'curious' && close && speed >= this.#options.startleSpeed
        && time - this.#lastStartle >= this.#options.startleCooldownMs) this.#startle(dx, time);
      else if (this.#noticed) this.#lookAt(dx, time);
    }
    this.#updateEvaluating();
  }

  #isFree() {
    return !this.#press && !this.#character.held && this.#reaction === null;
  }

  #lookAt(dx, time) {
    if (this.#character.isMoving || Math.abs(dx) < 8) return;
    const side = dx > 0 ? 'right' : 'left';
    if (side === this.#character.direction || time - this.#lastTurn < this.#options.turnCooldownMs) return;
    this.#lastTurn = time;
    this.#character.face(side);
  }

  #startle(dx, time) {
    if (this.#character.isMoving) return;
    this.#lastStartle = time;
    this.#log.debug('Startled by a fast mouse');
    this.#onInteract('startle');
    this.#character.face(dx > 0 ? 'right' : 'left');
    this.#react('surprised', ++this.#interaction);
  }

  #flee(dx, time) {
    if (this.#fleeing || time - this.#lastFlee < this.#options.fleeCooldownMs) {
      this.#lookAt(dx, time);
      return;
    }
    this.#lastFlee = time;
    const { x } = this.#character.position;
    const { min, max } = this.#character.walkableRange;
    const away = dx > 0 ? -1 : 1;
    const room = away < 0 ? x - min : max - x;
    // Cornered: dash past the cursor to the other side instead.
    const direction = room < this.#options.fleeDistance * 0.4 ? -away : away;
    const targetX = x + direction * this.#options.fleeDistance;

    this.#fleeing = true;
    this.#onInteract('flee');
    this.#log.debug(`Running away from the mouse to x=${Math.round(clamp(targetX, min, max))}`);
    this.#character.moveTo(targetX, { run: true, quiet: true }).then((arrived) => {
      this.#fleeing = false;
      // Peek back at the cursor from the new spot.
      if (arrived && this.#pointer) this.#character.face(this.#pointer.x > this.#character.position.x ? 'right' : 'left');
    });
  }

  #follow(dx, time) {
    const gap = Math.abs(dx);
    const { followDeadZone, followRunDistance } = this.#options;
    if (gap > followDeadZone) {
      // Keep running until close, so the pet doesn't flip between walk and run.
      const run = gap > followRunDistance || (this.#character.mode === 'run' && gap > followDeadZone * 3);
      this.#character.moveTo(this.#pointer.x, { run, quiet: true });
      return;
    }
    if (this.#character.hasTarget) this.#character.stop();
    this.#lookAt(dx, time);
    this.#reachFor(time);
  }

  #reachFor(time) {
    const head = this.#character.position.y - this.#character.size.height;
    const above = head - this.#pointer.y;
    if (above < 10 || above > this.#options.reachHeight) return;
    if (!this.#character.grounded || time - this.#lastReachJump < this.#options.reachJumpCooldownMs) return;
    this.#lastReachJump = time;
    this.#log.debug('Jumping to reach the mouse');
    this.#character.jump();
  }

  // Keep re-checking while something is going on, even without mouse moves
  // (e.g. the cursor rests above a following pet). Otherwise stay idle.
  #updateEvaluating() {
    const engaged = this.#mode === 'follow' || (this.#mode !== 'off' && this.#noticed);
    if (engaged && !this.#stopEvaluating) {
      this.#stopEvaluating = this.#ticker.after(this.#options.evaluateEveryMs, () => {
        this.#stopEvaluating = null;
        this.evaluate();
      });
    } else if (!engaged && this.#stopEvaluating) {
      this.#stopEvaluating();
      this.#stopEvaluating = null;
    }
  }

  // --- Clicks, drag and drop ------------------------------------------------------

  #pressMove(x, y, time) {
    const press = this.#press;
    if (!this.#dragging) {
      if (Math.hypot(x - press.x, y - press.y) < this.#options.dragThreshold) return;
      this.#startDrag(x, y, time);
    }
    this.#character.dragTo(x - press.offsetX, y - press.offsetY);
    this.#samples.push({ x, y, time });
    while (this.#samples.length > 2 && time - this.#samples[0].time > this.#options.throwWindowMs) this.#samples.shift();
  }

  #startDrag(x, y, time) {
    this.#interaction += 1;
    this.#reaction = null;
    this.#resumeAfterDrop = this.#snapshot();
    // Hold the pet where the cursor grabbed it (kept inside the pet's box).
    const { x: px, y: py } = this.#character.position;
    const { width, height } = this.#character.size;
    this.#press.offsetX = clamp(x - px, -width / 2, width / 2);
    this.#press.offsetY = clamp(y - py, -height, 0);
    this.#dragging = true;
    this.#samples = [{ x, y, time }];
    this.#character.grab();
    this.#onDragChange(true);
    this.#onInteract('grab');
  }

  async #drop(time) {
    this.#dragging = false;
    this.#onDragChange(false);
    const id = this.#interaction;
    const resume = this.#resumeAfterDrop;
    this.#resumeAfterDrop = null;

    const landed = await this.#character.release(this.#throwVelocity(time));
    if (!landed || id !== this.#interaction) return;

    const fall = this.#character.lastFallHeight;
    if (fall >= this.#options.bigFall) {
      this.#log.debug(`Dizzy after a ${Math.round(fall)}px fall`);
      this.#onInteract('dropped-hard');
      await this.#react('confused', id);
      if (id !== this.#interaction) return;
    }
    this.#resume(resume);
  }

  #throwVelocity(time) {
    const samples = this.#samples.filter((sample) => time - sample.time <= this.#options.throwWindowMs);
    this.#samples = [];
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const first = samples[0];
    const last = samples.at(-1);
    const seconds = (last.time - first.time) / 1000;
    if (seconds <= 0) return { vx: 0, vy: 0 };
    const max = this.#options.maxThrowSpeed;
    return {
      vx: clamp((last.x - first.x) / seconds, -max, max),
      vy: clamp((last.y - first.y) / seconds, -max, max),
    };
  }

  async #click(time) {
    const id = ++this.#interaction;
    const resume = this.#snapshot();
    this.#pokes = this.#pokes.filter((poke) => time - poke <= this.#options.pokeWindowMs);
    this.#pokes.push(time);
    const annoyed = this.#pokes.length >= this.#options.pokesForConfused;
    if (annoyed) this.#pokes = [];

    this.#log.debug(annoyed ? 'Poked too often: confused' : 'Clicked: happy');
    this.#onInteract(annoyed ? 'poked' : 'click');
    this.#character.stop();
    await this.#react(annoyed ? 'confused' : 'happy', id);
    if (id === this.#interaction) this.#resume(resume);
  }

  async #react(name, id) {
    this.#reaction = id;
    try {
      return await this.#character.play(name, { restart: true });
    } finally {
      if (this.#reaction === id) this.#reaction = null;
    }
  }

  // What the pet was doing, so it can carry on after being clicked or dropped.
  // Trips to a target (moveTo) are not resumed: whoever started them gets
  // `false` from their promise and decides what to do.
  #snapshot() {
    const { mode, direction, hasTarget } = this.#character;
    return (mode === 'walk' || mode === 'run') && !hasTarget ? { mode, direction } : null;
  }

  #resume(snapshot) {
    if (!snapshot || this.#character.isMoving || this.#character.held) return;
    this.#log.debug(`Resuming: ${snapshot.mode} ${snapshot.direction}`);
    this.#character[snapshot.mode](snapshot.direction);
  }

  #releaseHold() {
    this.#releasePointer?.();
    this.#releasePointer = null;
  }
}
