// Developer aid: plays every animation of a character in turn, so you can
// review new artwork in one go. Triggered from the dev context menu.

const MIN_STEP_MS = 1200; // give short one-shots (like blink) time to be seen
const MAX_STEP_MS = 2000; // looping animations never "finish", so cap them

let currentRun = 0;

export function stopShowcase() {
  currentRun += 1;
}

export async function playShowcase(character, ticker) {
  const run = ++currentRun;
  const wait = (ms) => new Promise((resolve) => ticker.after(ms, resolve));

  for (const name of character.animationNames) {
    if (run !== currentRun) return;
    const finished = character.play(name, { restart: true });
    await Promise.all([Promise.race([finished, wait(MAX_STEP_MS)]), wait(MIN_STEP_MS)]);
  }
  if (run === currentRun) character.play('idle');
}
