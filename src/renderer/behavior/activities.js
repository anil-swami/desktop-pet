// The things the pet can decide to do on its own.
//
// Each activity has:
//   state       label for logs ("State: IDLE → WALKING")
//   kind        how it affects personality (see RATES in Personality.js)
//   weight(ctx) how much it wants to run right now (0 = not at all)
//   priority    optional: higher tiers win outright (e.g. exhausted → nap)
//   cooldownMs  optional: minimum time between two starts
//   needsFloor  optional: hop down from an icon first
//   run(tools)  the script. Uses `await wait(ms)` and the pet's promise APIs,
//               and simply returns when interrupted (wait() resolves false).
//               say(topic) / think(topic) offer a line from dialogue/lines.js;
//               the dialogue rules decide whether it actually appears.
//
// Context (ctx): { personality, freeIcons, onIcon, desktopFresh, userAway, calm, app, treats }
//
// Adding a behavior = adding an object here. See README "Adding a behavior".

import { eatTreat } from './orders.js';

export const ACTIVITIES = [
  {
    // A treat left on the floor (e.g. you fed it and then dragged it away): go get it.
    name: 'eat-leftovers',
    state: 'HAPPY',
    kind: 'react',
    priority: ({ treats }) => (treats > 0 ? 4 : 1),
    weight: ({ treats }) => (treats > 0 ? 10 : 0),
    async run(tools) {
      await eatTreat(tools);
    },
  },
  {
    name: 'look-around',
    state: 'IDLE',
    kind: 'rest',
    weight: ({ personality: p }) => 1.5 + (100 - p.boredom) / 60,
    async run({ character, random, wait, say, context }) {
      if (!(await wait(random.between(2000, 5000)))) return;
      if (context.personality?.boredom > 65) say('bored', { chance: 0.5 });
      if (random.chance(0.5)) {
        character.turnAround();
        await wait(random.between(1200, 3000));
      }
    },
  },
  {
    name: 'wander',
    state: 'WALKING',
    kind: 'walk',
    needsFloor: true,
    weight: ({ personality: p, calm }) => (calm ? 0 : 1.5 + p.energy / 50 + p.boredom / 40),
    async run({ character, spot }) {
      await character.moveTo(spot(120, 450), { label: 'wander' });
    },
  },
  {
    name: 'dash',
    state: 'RUNNING',
    kind: 'run',
    needsFloor: true,
    cooldownMs: 20_000,
    weight: ({ personality: p, calm }) => (calm || p.energy < 45 ? 0 : (p.energy - 45) / 20 + p.boredom / 50),
    async run({ character, spot, say }) {
      say('dash', { chance: 0.3 });
      await character.moveTo(spot(350, 900), { run: true, label: 'dash' });
    },
  },
  {
    name: 'hop',
    state: 'PLAYING',
    kind: 'play',
    cooldownMs: 10_000,
    weight: ({ personality: p, calm }) => (calm || p.energy < 30 ? 0 : 0.4 + p.mood / 80 + p.boredom / 80),
    async run({ character, random, wait, say }) {
      say('play', { chance: 0.35 });
      const hops = random.int(1, 3);
      for (let i = 0; i < hops; i += 1) {
        if (!(await character.jump())) return;
        if (!(await wait(random.between(120, 400)))) return;
      }
    },
  },
  {
    name: 'sit',
    state: 'SITTING',
    kind: 'sit',
    cooldownMs: 8000,
    // Likes to sit and keep you company while you code or watch something.
    weight: ({ personality: p, app }) => 0.6 + (100 - p.energy) / 35 + (app === 'code' || app === 'media' ? 1.5 : 0),
    async run({ character, random, wait, say }) {
      character.play('sit');
      say('sit', { chance: 0.15 });
      if (await wait(random.between(6000, 16000))) character.play('idle');
    },
  },
  {
    name: 'nap',
    state: 'SLEEPING',
    kind: 'sleep',
    cooldownMs: 90_000,
    priority: ({ personality: p, userAway }) => (userAway || p.energy < 12 ? 3 : 1),
    weight: ({ personality: p, userAway }) => (userAway ? 10 : p.energy < 35 ? (35 - p.energy) / 4 : 0),
    async run({ character, random, wait, think, say, context }) {
      character.play('sleep');
      const duration = context.userAway ? 10 * 60_000 : random.between(20_000, 50_000);
      // A "Zzz..." thought now and then while asleep.
      const dream = () => think('sleep', { priority: 'event', cooldownMs: 8000 });
      dream();
      for (let slept = 0; slept < duration; slept += 10_000) {
        if (!(await wait(Math.min(10_000, duration - slept)))) return;
        dream();
      }
      await character.play('wake');
      say('wake', { priority: 'event', chance: 0.6 });
    },
  },
  {
    name: 'visit-icon',
    state: 'CURIOUS',
    kind: 'explore',
    cooldownMs: 2500,
    // The moment the desktop appears, icons beat everything else.
    priority: ({ freeIcons, desktopFresh }) => (desktopFresh && freeIcons > 0 ? 2 : 1),
    // With the desktop visible, hopping between icons is the favourite pastime.
    weight: ({ personality: p, freeIcons, calm, onIcon }) => {
      if (calm || freeIcons === 0 || p.energy < 15) return 0;
      return 4 + p.curiosity / 25 + (onIcon ? 2 : 0);
    },
    async run({ desktop, random, wait }) {
      if (!(await desktop.visit('random'))) return;
      await wait(random.between(4000, 10000)); // sit on it a while (visit() already sat down)
    },
  },
];
