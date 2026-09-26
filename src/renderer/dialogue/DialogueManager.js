// Decides WHEN the pet may say something, so bubbles feel lively without
// appearing constantly. It never touches the DOM: it tells a `view` to
// show({ text, style }) or hide().
//
//   dialogue.show("I'm bored...")                      a specific line
//   dialogue.topic('bored', { priority: 'ambient' })   a random line from lines.js
//   dialogue.think('Zzz...')                           a thought bubble
//
// Rules, checked in order:
//   1. speech off, or quiet mode (fullscreen app / you're away): only replies
//   2. never talk over a more important bubble
//   3. a minimum gap since the last bubble (long for idle chatter, none for replies)
//   4. the same topic/line not again within its cooldown
//   5. idle chatter only sometimes (chance x chattiness)
// Lines that don't pass are dropped, not queued: a late line is a stale line.

import { LINES } from './lines.js';

export const DIALOGUE_DEFAULTS = Object.freeze({
  // Minimum time since the previous bubble appeared, by priority.
  gapMs: Object.freeze({ ambient: 25_000, event: 4_000, reply: 0 }),
  // Minimum time before the same topic (or line) may appear again.
  cooldownMs: Object.freeze({ ambient: 90_000, event: 15_000, reply: 1_200 }),
  // How long a bubble stays: base + per character, within limits.
  baseDurationMs: 1800,
  perCharacterMs: 55,
  minDurationMs: 2200,
  maxDurationMs: 6000,
  maxTextLength: 120,
  maxNameLength: 20,
});

const RANK = Object.freeze({ ambient: 0, event: 1, reply: 2 });
const PLACEHOLDER = /\{(\w+)\}/g;
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export class DialogueManager {
  #view;
  #ticker;
  #random;
  #now;
  #log;
  #options;
  #lines;

  #enabled = true;
  #quiet = false;
  #chattiness = 1;
  #current = null; // { text, priority, cancelHide }
  #lastShownAt = -Infinity;
  #lastByKey = new Map();
  #lastLine = new Map();

  constructor({ view, ticker, random, now = () => performance.now(), log = silentLog, options = {}, lines = LINES }) {
    this.#view = view;
    this.#ticker = ticker;
    this.#random = random;
    this.#now = now;
    this.#log = log;
    this.#options = { ...DIALOGUE_DEFAULTS, ...options };
    this.#lines = lines;
  }

  get enabled() {
    return this.#enabled;
  }

  // Text of the bubble on screen, or null.
  get current() {
    return this.#current?.text ?? null;
  }

  setEnabled(enabled) {
    this.#enabled = enabled;
    if (!enabled) this.hide();
  }

  // Quiet: only direct replies (e.g. while a fullscreen video plays).
  setQuiet(quiet) {
    this.#quiet = quiet;
    if (quiet && this.#current && this.#current.priority !== 'reply') this.hide();
  }

  // 0 = no idle chatter, 1 = normal, 2 = twice as chatty (a setting in Phase 12).
  setChattiness(value) {
    this.#chattiness = Math.min(2, Math.max(0, Number(value) || 0));
  }

  show(text, options = {}) {
    return this.say(text, options);
  }

  say(text, options = {}) {
    return this.#present(text, { ...options, style: options.style ?? 'speech' });
  }

  think(text, options = {}) {
    return this.#present(text, { ...options, style: 'thought' });
  }

  // A random line from a topic in lines.js. Returns true if a bubble appeared.
  topic(name, options = {}) {
    const lines = this.#lines[name];
    if (!lines?.length) {
      this.#log.warn(`No lines for topic "${name}"`);
      return false;
    }
    const { priority = 'event', chance = 1, data } = options;
    const key = options.key ?? name;
    if (!this.#allowed(priority, key, chance, options.cooldownMs)) return false;
    const line = this.#pickLine(name, lines, data);
    if (!line) return false;
    this.#display(this.#fill(line, data), options.style ?? 'speech', priority, key, options.duration);
    return true;
  }

  hide() {
    if (!this.#current) return;
    this.#current.cancelHide();
    this.#current = null;
    this.#view.hide();
  }

  // How long a bubble with this text stays up.
  durationFor(text) {
    const { baseDurationMs, perCharacterMs, minDurationMs, maxDurationMs } = this.#options;
    return Math.min(maxDurationMs, Math.max(minDurationMs, baseDurationMs + perCharacterMs * text.length));
  }

  dispose() {
    this.hide();
  }

  #present(text, { style, priority = 'event', chance = 1, duration, cooldownMs, key }) {
    if (typeof text !== 'string' || !text.trim()) return false;
    const clean = text.trim().slice(0, this.#options.maxTextLength);
    if (!this.#allowed(priority, key ?? clean, chance, cooldownMs)) return false;
    this.#display(clean, style, priority, key ?? clean, duration);
    return true;
  }

  #allowed(priority, key, chance, cooldownMs) {
    if (!(priority in RANK)) priority = 'event';
    if (!this.#enabled) return false;
    if (this.#quiet && priority !== 'reply') return false;
    if (this.#current && RANK[this.#current.priority] > RANK[priority]) return false;

    const now = this.#now();
    const isChatter = priority === 'ambient';
    const gap = this.#options.gapMs[priority] / (isChatter ? this.#chattiness : 1); // chattiness 0 = never
    if (now - this.#lastShownAt < gap) return false;
    const cooldown = cooldownMs ?? this.#options.cooldownMs[priority];
    if (now - (this.#lastByKey.get(key) ?? -Infinity) < cooldown) return false;

    const probability = isChatter ? chance * this.#chattiness : chance;
    return probability >= 1 || this.#random.chance(probability);
  }

  #display(text, style, priority, key, duration) {
    this.#current?.cancelHide();
    const cancelHide = this.#ticker.after(duration ?? this.durationFor(text), () => this.hide());
    this.#current = { text, priority, cancelHide };
    const now = this.#now();
    this.#lastShownAt = now;
    this.#lastByKey.set(key, now);
    this.#view.show({ text, style });
    this.#log.debug(`${style === 'thought' ? 'Thinks' : 'Says'}: "${text}"`);
  }

  // Random line, not the one used last time, and only lines whose {values} we have.
  #pickLine(topic, lines, data) {
    const usable = lines.filter((line) => [...line.matchAll(PLACEHOLDER)].every(([, key]) => data?.[key]));
    if (usable.length === 0) return null;
    const last = this.#lastLine.get(topic);
    const fresh = usable.length > 1 ? usable.filter((line) => line !== last) : usable;
    const line = this.#random.pick(fresh);
    this.#lastLine.set(topic, line);
    return line;
  }

  #fill(line, data) {
    const max = this.#options.maxNameLength;
    return line.replace(PLACEHOLDER, (_, key) => {
      const value = String(data?.[key] ?? '').trim();
      return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    });
  }
}
