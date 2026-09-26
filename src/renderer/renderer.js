// Renderer entry point: wires the pet together inside the pet window's page.
// It has NO Node.js access; it only talks to the app through window.desktopPet
// (defined in preload.cjs).

import { Ticker } from './core/Ticker.js';
import { createLogger } from './core/logger.js';
import { Character } from './character/Character.js';
import { CharacterView } from './character/CharacterView.js';
import { ClickThrough } from './interaction/ClickThrough.js';
import { playMovementDemo, playShowcase, stopDemos } from './dev/demos.js';

const api = window.desktopPet;
const log = createLogger('app');
const pet = document.getElementById('pet');
const view = new CharacterView(pet);
const ticker = new Ticker();
let character = null;

new ClickThrough({ target: pet, api, ticker });

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api?.showContextMenu();
});

// The pet window covers the work area, so its size is the space the pet can use.
const currentArea = () => ({ width: window.innerWidth, height: window.innerHeight });

// Fires when the main process resizes the window (display changes, Phase 4).
window.addEventListener('resize', () => {
  if (!character) return;
  const area = currentArea();
  log.debug(`Area: ${area.width}x${area.height}`);
  character.setArea(area);
});

// --- Commands from the main process (context menu, later tray) ---------------

// Named spots along the ground, as a fraction of the width (clamped by movement).
const SPOTS = { left: 0, middle: 0.5, right: 1 };

function spotX(name) {
  const { width } = currentArea();
  if (name === 'random') return Math.random() * width;
  return Object.hasOwn(SPOTS, name) ? SPOTS[name] * width : null;
}

function handleCommand(command) {
  if (!character || typeof command?.type !== 'string') return;
  stopDemos();

  switch (command.type) {
    case 'play-animation':
      if (typeof command.name !== 'string') break;
      character.stop();
      character.play(command.name, { restart: true });
      break;
    case 'walk':
      character.walk(command.direction);
      break;
    case 'run':
      character.run(command.direction);
      break;
    case 'stop':
      character.stop();
      break;
    case 'jump':
      character.jump();
      break;
    case 'turn-around':
      character.turnAround();
      break;
    case 'move-to': {
      const x = spotX(command.spot);
      if (x !== null) character.moveTo(x, { run: command.run === true, label: command.spot });
      break;
    }
    case 'drop':
      character.placeAt(character.position.x, 0);
      break;
    case 'showcase':
      playShowcase(character, ticker);
      break;
    case 'movement-demo':
      playMovementDemo(character, ticker);
      break;
    default:
      log.warn(`Unknown command "${command.type}"`);
  }
}

// --- Startup -------------------------------------------------------------------

function uniqueFrameUrls(data) {
  return [...new Set(Object.values(data.animations).flatMap((animation) => animation.frames.map((frame) => frame.src)))];
}

function showFallback() {
  view.showFallback();
  view.setPosition(window.innerWidth / 2, window.innerHeight);
}

async function start() {
  if (!api) {
    console.error('[Pet:renderer] Preload bridge missing: window.desktopPet is undefined');
    showFallback();
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
    showFallback();
    return;
  }

  view.configure(data);
  const failed = await view.preload(uniqueFrameUrls(data));
  if (failed.length) log.warn(`${failed.length} frame image(s) failed to load: ${failed.join(', ')}`);

  const area = currentArea();
  character = new Character({ data, view, ticker, area, log: createLogger('character') });
  character.placeAt(area.width / 2); // bottom centre, standing on the taskbar
  api.onCommand(handleCommand);
  log.info(`Character "${data.name}" ready (${character.animationNames.length} animations), area ${area.width}x${area.height}`);
}

// Stop the loop and all timers if the page is ever torn down.
window.addEventListener('beforeunload', () => {
  character?.dispose();
  ticker.dispose();
});

start();
