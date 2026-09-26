// Renderer entry point: wires the pet together inside the pet window's page.
// It has NO Node.js access; it only talks to the app through window.desktopPet
// (defined in preload.cjs).

import { Ticker } from './core/Ticker.js';
import { createLogger } from './core/logger.js';
import { Character } from './character/Character.js';
import { CharacterView } from './character/CharacterView.js';
import { playShowcase, stopShowcase } from './dev/showcase.js';

const api = window.desktopPet;
const log = createLogger('app');
const pet = document.getElementById('pet');
const view = new CharacterView(pet);
const ticker = new Ticker();
let character = null;

// --- Click-through toggling -------------------------------------------------
// The window ignores the mouse by default, but still receives mousemove events
// (forwarded by the main process). When the cursor is over the pet we ask main
// to accept clicks; when it leaves, clicks pass through again. We only send
// IPC when the state actually changes, not on every mouse move.

let overPet = false;

function setOverPet(next) {
  if (next === overPet) return;
  overPet = next;
  api?.setClickThrough(!next);
}

document.addEventListener('mousemove', (event) => setOverPet(pet.contains(event.target)));
document.addEventListener('mouseleave', () => setOverPet(false));
window.addEventListener('blur', () => setOverPet(false));

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api?.showContextMenu();
});

// --- Commands from the main process (context menu, later tray) ---------------

function handleCommand(command) {
  if (!character || typeof command?.type !== 'string') return;
  if (command.type !== 'showcase') stopShowcase();

  switch (command.type) {
    case 'play-animation':
      if (typeof command.name === 'string') character.play(command.name, { restart: true });
      break;
    case 'turn-around':
      character.turnAround();
      break;
    case 'showcase':
      playShowcase(character, ticker);
      break;
    default:
      log.warn(`Unknown command "${command.type}"`);
  }
}

// --- Startup -------------------------------------------------------------------

function uniqueFrameUrls(data) {
  return [...new Set(Object.values(data.animations).flatMap((animation) => animation.frames.map((frame) => frame.src)))];
}

async function start() {
  if (!api) {
    console.error('[Pet:renderer] Preload bridge missing: window.desktopPet is undefined');
    view.showFallback();
    return;
  }

  let data = null;
  try {
    data = await api.getCharacter();
  } catch (err) {
    log.error(`Could not get character: ${err.message}`);
  }
  if (!data) {
    log.error('No character available; showing fallback shape');
    view.showFallback();
    return;
  }

  view.configure(data);
  const failed = await view.preload(uniqueFrameUrls(data));
  if (failed.length) log.warn(`${failed.length} frame image(s) failed to load: ${failed.join(', ')}`);

  character = new Character({ data, view, ticker, log: createLogger('character') });
  character.play('idle');
  api.onCommand(handleCommand);
  log.info(`Character "${data.name}" ready (${character.animationNames.length} animations)`);
}

// Stop the loop and all timers if the page is ever torn down.
window.addEventListener('beforeunload', () => {
  character?.dispose();
  ticker.dispose();
});

start();
