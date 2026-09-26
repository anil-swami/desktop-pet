// The pet's inner state: four numbers from 0 to 100 that change with what it
// does and what happens to it, and that make it choose what to do next.
//
//   energy     running and jumping tire it; sitting and sleeping restore it
//   boredom    grows while nothing happens; activities and attention reduce it
//   mood       clicks and fun raise it; being poked or dropped lowers it
//   curiosity  new things (apps, the desktop appearing) raise it; it settles back
//
// Instead of a timer ticking every second, the engine calls spend(kind, seconds)
// once when an activity ends, with the rates for that kind of activity.

export const PERSONALITY_START = Object.freeze({ energy: 80, boredom: 20, mood: 70, curiosity: 70 });

// Change per second while doing each kind of activity.
export const RATES = Object.freeze({
  rest:    { energy: +0.05, boredom: +0.4 },
  sit:     { energy: +0.2,  boredom: +0.25 },
  sleep:   { energy: +0.8,  boredom: -0.2 },
  walk:    { energy: -0.1,  boredom: -0.6 },
  run:     { energy: -0.6,  boredom: -1.2 },
  play:    { energy: -1.0,  boredom: -2.0, mood: +0.5 },
  explore: { energy: -0.15, boredom: -1.0, curiosity: -0.4, mood: +0.2 },
  react:   { boredom: -1.0 },
});

const MOOD_BASELINE = 60;
const CURIOSITY_BASELINE = 70;
const DRIFT_PER_SECOND = 0.01; // mood and curiosity slowly settle back to their baseline
const clamp = (value) => Math.min(100, Math.max(0, value));

export class Personality {
  #values;

  constructor(start = PERSONALITY_START) {
    this.#values = { ...PERSONALITY_START, ...start };
  }

  get energy() { return this.#values.energy; }
  get boredom() { return this.#values.boredom; }
  get mood() { return this.#values.mood; }
  get curiosity() { return this.#values.curiosity; }

  get moodLabel() {
    const { mood, energy } = this.#values;
    if (energy < 20) return 'tired';
    if (mood >= 70) return 'happy';
    if (mood < 30) return 'grumpy';
    return 'calm';
  }

  snapshot() {
    return { ...this.#values, moodLabel: this.moodLabel };
  }

  // Apply `seconds` of an activity of this kind.
  spend(kind, seconds) {
    const rates = RATES[kind] ?? RATES.rest;
    for (const [key, perSecond] of Object.entries(rates)) this.#values[key] = clamp(this.#values[key] + perSecond * seconds);
    const drift = Math.min(1, DRIFT_PER_SECOND * seconds);
    this.#values.mood = clamp(this.#values.mood + (MOOD_BASELINE - this.#values.mood) * drift);
    this.#values.curiosity = clamp(this.#values.curiosity + (CURIOSITY_BASELINE - this.#values.curiosity) * drift);
  }

  // One-off changes from events, e.g. { mood: +8, boredom: -15 } for a click.
  adjust(changes) {
    for (const [key, delta] of Object.entries(changes)) {
      if (key in this.#values) this.#values[key] = clamp(this.#values[key] + delta);
    }
  }
}
