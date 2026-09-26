// All of the pet's randomness goes through one Random object, instead of
// Math.random() sprinkled everywhere. That keeps chance in one place to tune,
// and lets tests pass a seed to get the same "random" choices every run.

// mulberry32: a tiny, fast, seedable pseudo-random generator (good enough for
// games; not for security).
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Random {
  #next;

  // No seed: real randomness. A number: a repeatable sequence (tests).
  constructor(seed) {
    this.#next = seed === undefined ? Math.random : mulberry32(seed);
  }

  // 0 <= value < 1
  float() {
    return this.#next();
  }

  between(min, max) {
    return min + this.#next() * (max - min);
  }

  // Whole number from min to max, both included.
  int(min, max) {
    return Math.floor(this.between(min, max + 1));
  }

  chance(probability) {
    return this.#next() < probability;
  }

  pick(list) {
    return list.length ? list[Math.floor(this.#next() * list.length)] : undefined;
  }

  // entries: [{ weight, ... }]. Higher weight = more likely.
  weighted(entries) {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) return undefined;
    let roll = this.#next() * total;
    for (const entry of entries) {
      roll -= Math.max(0, entry.weight);
      if (roll < 0) return entry;
    }
    return entries.at(-1);
  }
}
