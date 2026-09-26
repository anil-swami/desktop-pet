// Things you can ASK the pet to do (pet menu, petting, feeding).
//
// An order is written like an activity (see activities.js) and run by the
// BehaviorManager, but it:
//   - jumps the queue and runs even when "Live on its own" is off
//   - is cut short by the next order, a click or a drag (like any activity)
//   - holdMs: afterwards, autonomy waits this long before doing its own thing
//
// Tools available to run(): character, desktop, random, wait, say, think,
// adjust (personality), pointer() (last known cursor), treats, effects.

const TREAT_REACH = 30; // px between the pet's centre and the treat when it eats

// Walk to a treat and eat it. Used by the "feed" order and by the
// "eat-leftovers" activity (a treat left behind after an interruption).
export async function eatTreat({ character, desktop, treats, say, adjust }, treat = treats?.nearest(character.position.x)) {
  if (!treat) return false;
  if (character.standingOn !== null) await desktop?.leave();
  if (!(await treats.whenLanded(treat))) return false;

  // Stop just in front of the treat, facing it, so the crumbs fly from its mouth.
  const side = Math.sign(treat.x - character.position.x) || 1;
  const stopX = treat.x - side * TREAT_REACH;
  const distance = Math.abs(stopX - character.position.x);
  if (distance > 6 && !(await character.moveTo(stopX, { run: distance > 200, label: 'treat' }))) return false;
  character.face(treat.x >= character.position.x ? 'right' : 'left');
  if (!treats.eat(treat)) return false;

  adjust({ energy: +20, mood: +10, boredom: -10 });
  say('eat', { priority: 'reply' });
  await character.play('happy', { restart: true });
  return true;
}

export const ORDERS = Object.freeze({
  // Follow the cursor for a moment: move the mouse where you want the pet,
  // it runs there and stops once the cursor settles (or after 12 s).
  come: {
    name: 'order-come',
    state: 'WALKING',
    kind: 'walk',
    needsFloor: true,
    holdMs: 8000,
    async run({ character, wait, pointer, say }) {
      const STEP = 150;
      let settled = 0;
      for (let elapsed = 0; elapsed < 12_000; elapsed += STEP) {
        const cursor = pointer();
        if (cursor) {
          const gap = cursor.x - character.position.x;
          if (Math.abs(gap) > 30) {
            character.moveTo(cursor.x, { run: Math.abs(gap) > 250, quiet: true });
            settled = 0;
          } else if ((settled += STEP) >= 900) {
            break;
          }
        }
        if (!(await wait(STEP))) return;
      }
      character.stop();
      const cursor = pointer();
      if (cursor) character.face(cursor.x > character.position.x ? 'right' : 'left');
      say('comeHere', { priority: 'reply' });
    },
  },

  // Sit and stay for a little while (20 s, or until something else happens).
  sit: {
    name: 'order-sit',
    state: 'SITTING',
    kind: 'sit',
    speech: { topic: 'sitOk', priority: 'reply' },
    async run({ character, wait }) {
      character.play('sit');
      if (await wait(20_000)) character.play('idle');
    },
  },

  // Sleep until woken (or 5 minutes).
  sleep: {
    name: 'order-sleep',
    state: 'SLEEPING',
    kind: 'sleep',
    speech: { topic: 'sleepOk', priority: 'reply' },
    async run({ character, wait, think }) {
      character.play('sleep');
      for (let slept = 0; slept < 5 * 60_000; slept += 10_000) {
        if (!(await wait(10_000))) return;
        think('sleep', { priority: 'event', cooldownMs: 8000 });
      }
      await character.play('wake');
    },
  },

  wake: {
    name: 'order-wake',
    state: 'HAPPY',
    kind: 'react',
    holdMs: 3000,
    speech: { topic: 'woken', priority: 'reply' },
    async run({ character }) {
      await character.play('wake', { restart: true });
    },
  },

  // Zoomies: run to one side of the screen, then the other.
  zoomies: {
    name: 'order-zoomies',
    state: 'RUNNING',
    kind: 'run',
    needsFloor: true,
    holdMs: 3000,
    speech: { topic: 'zoomies', priority: 'reply' },
    async run({ character, random }) {
      const { min, max } = character.walkableRange;
      const nearLeft = character.position.x - min < max - character.position.x;
      const sides = nearLeft ? [max, min] : [min, max];
      for (const x of sides) {
        if (!(await character.moveTo(x + random.between(-40, 40), { run: true, label: 'zoomies' }))) return;
      }
      await character.jump();
    },
  },

  // Stop everything and stay put for a while.
  stop: {
    name: 'order-stop',
    state: 'IDLE',
    kind: 'rest',
    holdMs: 30_000,
    speech: { topic: 'stopOk', priority: 'reply' },
    async run({ character }) {
      character.stop();
      if (character.grounded && character.animation !== 'idle') character.play('idle');
    },
  },

  // Being petted: hearts and a happy wiggle.
  pet: {
    name: 'order-pet',
    state: 'HAPPY',
    kind: 'react',
    holdMs: 3000,
    speech: { topic: 'petted', priority: 'reply' },
    async run({ character, effects, adjust }) {
      adjust({ mood: +8, boredom: -10 });
      effects?.hearts();
      await character.whenLanded();
      await character.play('happy', { restart: true });
    },
  },

  // Drop a treat next to the pet, then go and eat it.
  feed: {
    name: 'order-feed',
    state: 'HAPPY',
    kind: 'react',
    holdMs: 3000,
    async run(tools) {
      const { character, random, treats } = tools;
      const { min, max } = character.walkableRange;
      const side = random.chance(0.5) ? 1 : -1;
      let x = character.position.x + side * random.between(120, 220);
      if (x < min || x > max) x = character.position.x - side * random.between(120, 220);
      const treat = treats.spawn(Math.min(max, Math.max(min, x)), character.floorY - 260);
      character.face((treat?.x ?? x) > character.position.x ? 'right' : 'left');
      await eatTreat(tools, treat ?? undefined);
    },
  },
});
