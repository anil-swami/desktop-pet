// Renderer entry point: wires the pet together inside the pet window's page.
// It has NO Node.js access; it only talks to the app through window.desktopPet
// (defined in preload.cjs).

import { Ticker } from './core/Ticker.js';
import { Random } from './core/Random.js';
import { createLogger } from './core/logger.js';
import { Character } from './character/Character.js';
import { CharacterView } from './character/CharacterView.js';
import { ClickThrough } from './interaction/ClickThrough.js';
import { MouseInteraction } from './interaction/MouseInteraction.js';
import { DesktopInteraction } from './interaction/DesktopInteraction.js';
import { BehaviorManager } from './behavior/BehaviorManager.js';
import { playMovementDemo, playShowcase, stopDemos } from './dev/demos.js';

const api = window.desktopPet;
const log = createLogger('app');
const pet = document.getElementById('pet');
const view = new CharacterView(pet);
const ticker = new Ticker();
const random = new Random();
const clickThrough = new ClickThrough({ target: pet, api, ticker });
let character = null;
let mouse = null;
let desktop = null;
let behavior = null;

// The menu shows current settings and what the pet is doing, so send them along.
pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api?.showContextMenu({ mouseMode: mouse?.mode, behavior: behavior?.describe() });
});

// The pet window covers the work area, so its size is the space the pet can use.
const currentArea = () => ({ width: window.innerWidth, height: window.innerHeight });

// Fires when the main process refits the window after a display change
// (resolution, scaling, taskbar...). The pet re-clamps itself into the new
// area; if the ground dropped away, it falls to the new bottom edge.
window.addEventListener('resize', () => {
  if (!character) return;
  const area = currentArea();
  if (area.width < 1 || area.height < 1) return; // transient size during a display change
  desktop?.cancel(); // icon positions change with the display; get off any icon
  character.setArea(area);
  const { x, y } = character.position;
  log.debug(`Area: ${area.width}x${area.height}, pet at (${Math.round(x)}, ${Math.round(y)})`);
});

// --- What the user does with the mouse, as the behavior engine sees it --------

const MOUSE_EFFECTS = {
  press:          { pause: 4000 },
  click:          { mood: +6, boredom: -15 },
  poked:          { mood: -8 },
  grab:           { pause: 6000 },
  'dropped-hard': { mood: -5 },
  startle:        { pause: 3000 },
  flee:           { pause: 4000 },
};

function onMouseInteraction(kind) {
  stopDemos();
  const effect = MOUSE_EFFECTS[kind];
  if (!effect || !behavior) return;
  const { pause, ...changes } = effect;
  if (pause) behavior.interrupt(`mouse: ${kind}`, pause);
  if (Object.keys(changes).length) behavior.personality.adjust(changes);
}

// --- Commands and events from the main process ---------------------------------

// Named spots along the ground, as a fraction of the width (clamped by movement).
const SPOTS = { left: 0, middle: 0.5, right: 1 };

function spotX(name) {
  const { width } = currentArea();
  if (name === 'random') return random.float() * width;
  return Object.hasOwn(SPOTS, name) ? SPOTS[name] * width : null;
}

// A direct movement order overrides "follow the mouse" and any icon visit.
const MOVEMENT_COMMANDS = new Set(['walk', 'run', 'stop', 'move-to', 'movement-demo', 'drop', 'visit-icon']);
// Anything you ask for by hand pauses the pet's own ideas for a while.
const MANUAL_PAUSE_MS = 20_000;

function handleCommand(command) {
  if (!character || typeof command?.type !== 'string') return;

  // Events, not orders: they inform the behavior engine and nothing else.
  if (command.type === 'app-changed') {
    behavior?.onAppChanged(command.app && typeof command.app === 'object' ? command.app : null);
    return;
  }
  if (command.type === 'user-away') {
    behavior?.setUserAway(command.away === true);
    return;
  }
  if (command.type === 'autonomy') {
    behavior?.setEnabled(command.enabled === true);
    return;
  }

  stopDemos();
  if (command.type !== 'mouse-mode') behavior?.interrupt(`command: ${command.type}`, MANUAL_PAUSE_MS);
  if (mouse?.mode === 'follow' && MOVEMENT_COMMANDS.has(command.type)) mouse.setMode('curious');
  if (MOVEMENT_COMMANDS.has(command.type) && command.type !== 'visit-icon') desktop?.cancel();

  switch (command.type) {
    case 'visit-icon':
      if (typeof command.id === 'string') desktop?.visit(command.id);
      break;
    case 'leave-icon':
      desktop?.leave();
      break;
    case 'mouse-mode':
      mouse?.setMode(command.mode);
      break;
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
      behavior?.interrupt('demo', 30_000);
      playShowcase(character, ticker);
      break;
    case 'movement-demo':
      behavior?.interrupt('demo', 30_000);
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
  const chance = () => random.float();
  character = new Character({ data, view, ticker, area, random: chance, log: createLogger('character') });
  character.placeAt(area.width / 2); // bottom centre, standing on the taskbar

  mouse = new MouseInteraction({
    character,
    ticker,
    log: createLogger('mouse'),
    holdPointer: () => clickThrough.hold(),
    onDragChange: (dragging) => document.body.classList.toggle('is-dragging', dragging),
    onInteract: onMouseInteraction,
  });
  mouse.attach(pet);

  desktop = new DesktopInteraction({
    character,
    getIcons: () => api.getDesktopIcons(),
    ticker,
    random: chance,
    log: createLogger('desktop'),
  });

  behavior = new BehaviorManager({
    character,
    desktop,
    ticker,
    random,
    log: createLogger('behavior'),
    isBusy: () => mouse.busy,
  });

  api.onCommand(handleCommand);
  // Catch up on what happened while we were loading (the app in front, user away?).
  try {
    const context = await api.getContext();
    if (context?.app) behavior.onAppChanged(context.app);
    if (context?.userAway) behavior.setUserAway(true);
  } catch (err) {
    log.warn(`Could not get the current context: ${err.message}`);
  }
  behavior.start();
  log.info(`Character "${data.name}" ready (${character.animationNames.length} animations), area ${area.width}x${area.height}`);
}

// Stop the loop and all timers if the page is ever torn down.
window.addEventListener('beforeunload', () => {
  behavior?.dispose();
  desktop?.dispose();
  mouse?.dispose();
  character?.dispose();
  ticker.dispose();
});

start();
