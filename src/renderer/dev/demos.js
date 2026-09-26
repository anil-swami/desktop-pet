// Developer demos, triggered from the dev context menu:
//   playShowcase      every animation in turn (review new artwork)
//   playMovementDemo  a short walk / run / jump routine
// Any other command stops a running demo (stopDemos).
//
// They are written with the same promise API future behaviors will use:
//   await pet.moveTo(x); await pet.jump();

const MIN_STEP_MS = 1200; // give short one-shots (like blink) time to be seen
const MAX_STEP_MS = 2000; // looping animations never "finish", so cap them

let currentRun = 0;

export function stopDemos() {
  currentRun += 1;
}

function startRun(ticker) {
  const run = ++currentRun;
  return {
    active: () => run === currentRun,
    wait: (ms) => new Promise((resolve) => ticker.after(ms, resolve)),
  };
}

export async function playShowcase(character, ticker) {
  const { active, wait } = startRun(ticker);
  character.stop();
  for (const name of character.animationNames) {
    if (!active()) return;
    const finished = character.play(name, { restart: true });
    await Promise.all([Promise.race([finished, wait(MAX_STEP_MS)]), wait(MIN_STEP_MS)]);
  }
  if (active()) character.play('idle');
}

export async function playMovementDemo(character, ticker) {
  const { active, wait } = startRun(ticker);
  const home = character.position.x;
  const steps = [
    () => character.moveTo(home - 250, { label: 'demo left' }),
    () => wait(500),
    () => character.moveTo(home + 250, { run: true, label: 'demo right' }),
    () => character.jump(),
    () => wait(300),
    () => character.moveTo(home, { label: 'demo home' }),
    () => character.jump(),
  ];
  for (const step of steps) {
    if (!active()) return;
    await step();
  }
}
