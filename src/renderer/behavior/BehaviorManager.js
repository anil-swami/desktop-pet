// The pet's autonomous life: an endless loop of "pick an activity, do it".
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ an order from you (menu, petting, feeding)? ─yes─▶ do it now     │
//   │ paused? busy? switched off? ─yes─▶ rest until woken              │
//   │ reaction queued (app switch, user back)? ─yes─▶ do that          │
//   │ else build context ─▶ scheduler picks by weight ─▶ run activity │
//   │ personality.spend(activity.kind, how long it took)               │
//   └──────────────────────────────────────────────────────────────────┘
//
// Interruptions: clicks, drags and menu commands call interrupt(reason, pause):
// the running activity's pending wait() resolves false, the activity returns,
// and the loop rests for `pause` before choosing again. The interrupter decides
// what the pet does in the meantime.
//
// Orders (see orders.js) jump the queue, run even when autonomy is off, and
// set their own pause afterwards (holdMs).
//
// Phase 7 plugs in here: onAppChanged() reacts to the app in front, and the
// desktop appearing makes icon-hopping the top priority.

import { ACTIVITIES } from './activities.js';
import { BehaviorScheduler } from './BehaviorScheduler.js';
import { Personality } from './Personality.js';

// What the pet does when you switch apps. `topic` names the lines in dialogue/lines.js.
export const APP_REACTIONS = Object.freeze({
  code:     { state: 'HAPPY', animation: 'happy', topic: 'appCode', cooldownMs: 5 * 60_000 },
  browser:  { state: 'CURIOUS', look: true, topic: 'appBrowser', cooldownMs: 5 * 60_000 },
  terminal: { state: 'SURPRISED', animation: 'surprised', topic: 'appTerminal', cooldownMs: 5 * 60_000 },
  chat:     { state: 'HAPPY', animation: 'happy', topic: 'appChat', cooldownMs: 5 * 60_000 },
  media:    { state: 'HAPPY', animation: 'happy', topic: 'appMedia', cooldownMs: 5 * 60_000 },
  office:   { state: 'THINKING', animation: 'confused', topic: 'appOffice', cooldownMs: 5 * 60_000 },
  folder:   { state: 'SURPRISED', animation: 'surprised', topic: 'appFolder', cooldownMs: 30_000, onlyNew: true },
  desktop:  { state: 'HAPPY', animation: 'happy', topic: 'appDesktop', cooldownMs: 2 * 60_000 },
});

const REACTION_GAP_MS = 30_000;       // at most one app reaction per 30 s
const DESKTOP_FRESH_MS = 10_000;      // "the desktop just appeared" lasts this long
const ICON_CHECK_MS = 4000;           // re-scan icons at most this often when choosing
const EASILY_INTERRUPTED = new Set(['rest', 'sit', 'walk']);
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class BehaviorManager {
  #character;
  #desktop;
  #ticker;
  #random;
  #personality;
  #scheduler;
  #activities;
  #log;
  #now;
  #isBusy;
  #speak;
  #tools;
  #extraContext;

  #running = false;
  #enabled = true;
  #token = 0;
  #pausedUntil = 0;
  #waits = new Set();
  #wakeLoop = null;
  #state = 'IDLE';
  #current = null;      // activity being performed
  #orders = [];         // from the user: run first, even when autonomy is off
  #reactions = [];      // to events (app switch, user back)

  #app = null;
  #userAway = false;
  #desktopShownAt = -Infinity;
  #lastReactionAt = -Infinity;
  #reactedAt = new Map();
  #freeIcons = 0;
  #iconsCheckedAt = -Infinity;

  constructor({
    character,
    desktop = null,
    ticker,
    random,
    personality = new Personality(),
    activities = ACTIVITIES,
    log = silentLog,
    now = () => performance.now(),
    isBusy = () => false,
    // speak({ topic, style, priority, chance, ... }): show a line (DialogueManager.topic).
    speak = () => {},
    // Extra tools handed to activities and orders (e.g. treats, effects, pointer).
    tools = {},
    // Extra context values for activity weights, e.g. () => ({ treats: 2 }).
    extraContext = () => ({}),
  }) {
    this.#character = character;
    this.#desktop = desktop;
    this.#ticker = ticker;
    this.#random = random;
    this.#personality = personality;
    this.#activities = activities;
    this.#log = log;
    this.#now = now;
    this.#isBusy = isBusy;
    this.#speak = speak;
    this.#tools = tools;
    this.#extraContext = extraContext;
    this.#scheduler = new BehaviorScheduler({ random, now });
  }

  get state() {
    return this.#state;
  }

  get enabled() {
    return this.#enabled;
  }

  get personality() {
    return this.#personality;
  }

  // What the pet is up to, in the shape of the spec: { mood, energy, ..., activity, attention }.
  describe() {
    const p = this.#personality.snapshot();
    return {
      mood: p.moodLabel,
      energy: Math.round(p.energy),
      curiosity: Math.round(p.curiosity),
      boredom: Math.round(p.boredom),
      activity: this.#current?.name ?? 'none',
      attention: this.#app?.category ?? 'desktop',
      state: this.#state,
      enabled: this.#enabled,
    };
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#loop();
  }

  stop() {
    this.#running = false;
    this.#token += 1;
    this.#cancelWaits();
    this.#wakeLoop?.();
  }

  setEnabled(enabled) {
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    this.#log.info(`Autonomous behavior ${enabled ? 'on' : 'off'}`);
    this.interrupt(enabled ? 'switched on' : 'switched off', 0);
    if (!enabled && !this.#character.held) this.#character.stop();
    this.#setState(enabled ? 'IDLE' : 'OFF');
  }

  // Do what the user asked (see orders.js), right now. Replaces any earlier
  // order that hasn't finished, and ignores pauses from before.
  order(activity) {
    this.#orders = [activity];
    this.#pausedUntil = 0;
    this.#token += 1;
    this.#cancelWaits();
    if (!this.#character.held) this.#character.stop();
    this.#log.info(`Order: ${activity.name.replace(/^order-/, '')}`);
    this.#wakeLoop?.();
  }

  // Something else takes over (user, command, a reaction). The current
  // activity ends now, and nothing new starts for `pauseMs`.
  interrupt(reason, pauseMs = 5000) {
    this.#token += 1;
    this.#cancelWaits();
    // Stop the walk the activity started, so its moveTo() resolves right away.
    if (this.#current && !this.#character.held) this.#character.stop();
    this.#pausedUntil = Math.max(this.#pausedUntil, this.#now() + pauseMs);
    if (pauseMs > 0) this.#log.debug(`Autonomy paused ${Math.round(pauseMs / 1000)} s (${reason})`);
    this.#wakeLoop?.();
  }

  setUserAway(away) {
    if (away === this.#userAway) return;
    this.#userAway = away;
    if (away) {
      this.interrupt('user away', 0); // next choice: a long nap
    } else if (this.#state === 'SLEEPING') {
      this.#queueReaction({
        name: 'welcome-back',
        state: 'HAPPY',
        kind: 'react',
        speech: { topic: 'welcomeBack', priority: 'reply' },
        async run({ character }) {
          await character.play('wake', { restart: true });
          await character.play('happy', { restart: true });
        },
      });
    }
  }

  // info: { category, app, maximized, fullscreen, newFolder } or null (noticing apps switched off)
  onAppChanged(info) {
    const previous = this.#app;
    this.#app = info;
    this.#iconsCheckedAt = -Infinity; // any switch can change which icons are covered
    if (!info) return;

    const calm = info.fullscreen, wasCalm = previous?.fullscreen === true;
    if (calm !== wasCalm) {
      this.#log.info(calm ? 'Fullscreen app: calming down' : 'Fullscreen ended');
      if (calm) {
        this.interrupt('fullscreen', 0);
        if (!this.#character.held) this.#character.stop();
      }
    }

    if (info.category === 'desktop') {
      this.#desktopShownAt = this.#now();
      this.#personality.adjust({ curiosity: +10 });
      // Drop a boring activity so the pet reacts right away.
      if (this.#current && EASILY_INTERRUPTED.has(this.#current.kind)) this.interrupt('desktop appeared', 0);
    }

    const reaction = this.#reactionFor(info);
    if (reaction) this.#queueReaction(reaction);
  }

  dispose() {
    this.stop();
  }

  // --- The loop -------------------------------------------------------------------

  async #loop() {
    while (this.#running) {
      if (this.#orders.length > 0) {
        if (this.#character.held) {
          await this.#rest(500); // can't obey while dangling from the cursor
          continue;
        }
        const order = this.#orders.shift();
        const token = this.#token;
        await this.#perform(order, token, null);
        if (token === this.#token && order.holdMs) this.#pausedUntil = Math.max(this.#pausedUntil, this.#now() + order.holdMs);
        continue;
      }
      if (!this.#enabled) {
        this.#setState('OFF');
        await this.#rest(60_000);
        continue;
      }
      const pause = this.#pausedUntil - this.#now();
      if (pause > 0) {
        await this.#rest(pause);
        continue;
      }
      if (this.#isBusy() || this.#character.held) {
        await this.#rest(1000);
        continue;
      }

      const token = this.#token;
      let activity = this.#reactions.shift();
      let context = null;
      if (!activity) {
        context = await this.#buildContext();
        if (token !== this.#token || !this.#running) continue; // interrupted while scanning
        activity = this.#scheduler.choose(this.#activities, context);
      }
      if (!activity) {
        await this.#rest(2000);
        continue;
      }
      await this.#perform(activity, token, context);
      if (token === this.#token) await this.#rest(this.#random.between(300, 1200));
    }
  }

  async #perform(activity, token, context) {
    this.#current = activity;
    this.#setState(activity.state, activity.name);
    if (activity.speech) this.#speak(activity.speech);
    const started = this.#now();
    try {
      if (activity.needsFloor && this.#character.standingOn !== null && this.#desktop) {
        await this.#desktop.leave();
        if (token !== this.#token) return;
      }
      await activity.run({
        ...this.#tools,
        character: this.#character,
        desktop: this.#desktop,
        random: this.#random,
        context: context ?? {},
        adjust: (changes) => this.#personality.adjust(changes),
        wait: (ms) => this.#wait(ms, token),
        active: () => token === this.#token,
        spot: (min, max) => this.#spot(min, max),
        // Idle chatter by default; the dialogue rules decide if it actually shows.
        say: (topic, options = {}) => this.#speak({ topic, priority: 'ambient', ...options }),
        think: (topic, options = {}) => this.#speak({ topic, priority: 'ambient', ...options, style: 'thought' }),
      });
    } catch (err) {
      this.#log.error(`Activity "${activity.name}" failed: ${err.message}`);
    } finally {
      this.#personality.spend(activity.kind, (this.#now() - started) / 1000);
      this.#current = null;
    }
  }

  async #buildContext() {
    const personality = this.#personality.snapshot();
    const calm = this.#app?.fullscreen === true;
    return {
      ...this.#extraContext(),
      personality,
      freeIcons: calm ? 0 : await this.#countFreeIcons(),
      onIcon: this.#character.standingOn !== null,
      desktopFresh: this.#now() - this.#desktopShownAt < DESKTOP_FRESH_MS,
      userAway: this.#userAway,
      calm,
      app: this.#app?.category ?? null,
    };
  }

  // How many icons could be visited. A maximized or fullscreen app hides every
  // icon, so there's no need to ask the helper then.
  async #countFreeIcons() {
    if (!this.#desktop) return 0;
    const app = this.#app;
    if (app && (app.maximized || app.fullscreen) && app.category !== 'desktop') return 0;
    if (this.#now() - this.#iconsCheckedAt < ICON_CHECK_MS) return this.#freeIcons;
    this.#freeIcons = await this.#desktop.freeIconCount();
    this.#iconsCheckedAt = this.#now();
    return this.#freeIcons;
  }

  #reactionFor(info) {
    const spec = APP_REACTIONS[info.category];
    if (!spec || (spec.onlyNew && !info.newFolder)) return null;
    if (!this.#enabled || this.#userAway || info.fullscreen || this.#state === 'SLEEPING') return null;
    const now = this.#now();
    if (now - this.#lastReactionAt < REACTION_GAP_MS) return null;
    if (now - (this.#reactedAt.get(info.category) ?? -Infinity) < spec.cooldownMs) return null;
    this.#lastReactionAt = now;
    this.#reactedAt.set(info.category, now);
    this.#personality.adjust({ curiosity: +8, boredom: -10 });

    this.#log.info(`Noticed ${info.category === 'folder' ? 'a folder being opened' : `${info.app} (${info.category})`}`);
    return {
      name: `react-${info.category}`,
      state: spec.state,
      kind: 'react',
      speech: { topic: spec.topic, priority: 'event' },
      async run({ character, wait }) {
        await character.whenLanded(); // landing would replace the animation
        if (spec.animation) {
          if (character.mode !== 'idle') character.stop();
          await character.play(spec.animation, { restart: true });
        }
        if (spec.look) {
          character.turnAround();
          if (await wait(900)) character.turnAround();
        }
      },
    };
  }

  #queueReaction(reaction) {
    this.#reactions = [reaction]; // only the latest matters
    this.interrupt(`reacting: ${reaction.name}`, 0);
  }

  // A random spot on the floor, min–max px away (turned back at the screen edge).
  #spot(min, max) {
    const { x } = this.#character.position;
    const { min: left, max: right } = this.#character.walkableRange;
    const distance = this.#random.between(min, max);
    let direction = this.#random.chance(0.5) ? 1 : -1;
    if (x + direction * distance > right || x + direction * distance < left) direction = -direction;
    return Math.min(right, Math.max(left, x + direction * distance));
  }

  #setState(state, activityName) {
    if (state === this.#state) return;
    this.#log.debug(`State: ${this.#state} → ${state}${activityName ? ` (${activityName})` : ''}`);
    this.#state = state;
  }

  // Resolves true after ms, or false as soon as the activity is interrupted.
  #wait(ms, token) {
    if (token !== this.#token) return Promise.resolve(false);
    return new Promise((resolve) => {
      const entry = { resolve, cancel: null };
      entry.cancel = this.#ticker.after(ms, () => {
        this.#waits.delete(entry);
        resolve(token === this.#token);
      });
      this.#waits.add(entry);
    });
  }

  #cancelWaits() {
    for (const entry of this.#waits) {
      entry.cancel();
      entry.resolve(false);
    }
    this.#waits.clear();
  }

  // The loop's own pause; interrupt() and setEnabled() cut it short.
  #rest(ms) {
    return new Promise((resolve) => {
      const cancel = this.#ticker.after(ms, () => {
        this.#wakeLoop = null;
        resolve();
      });
      this.#wakeLoop = () => {
        cancel();
        this.#wakeLoop = null;
        resolve();
      };
    });
  }
}
