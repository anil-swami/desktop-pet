// Picks the next activity. No if/else chains: each activity says how much it
// wants to run right now (its weight), and the scheduler rolls a weighted die.
//
//   1. drop activities still on cooldown
//   2. keep only the highest priority tier that has something to offer
//      (e.g. "exhausted, must nap" or "the desktop just appeared" beat normal wishes)
//   3. weighted random pick: weight 4 is twice as likely as weight 2
//
// Unpredictable, but not chaotic: likely choices follow the pet's state.

export class BehaviorScheduler {
  #random;
  #now;
  #lastStarted = new Map();

  constructor({ random, now = () => performance.now() }) {
    this.#random = random;
    this.#now = now;
  }

  // Candidates with their weight and priority, for logs and tests.
  rank(activities, context) {
    const now = this.#now();
    return activities
      .filter((activity) => now - (this.#lastStarted.get(activity.name) ?? -Infinity) >= (activity.cooldownMs ?? 0))
      .map((activity) => ({
        activity,
        weight: Math.max(0, activity.weight(context)),
        priority: typeof activity.priority === 'function' ? activity.priority(context) : (activity.priority ?? 1),
      }))
      .filter((candidate) => candidate.weight > 0);
  }

  choose(activities, context) {
    const candidates = this.rank(activities, context);
    if (candidates.length === 0) return null;
    const top = Math.max(...candidates.map((candidate) => candidate.priority));
    const pick = this.#random.weighted(candidates.filter((candidate) => candidate.priority === top));
    this.#lastStarted.set(pick.activity.name, this.#now());
    return pick.activity;
  }
}
