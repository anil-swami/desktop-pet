// Builds the native right-click menu for the pet.
// Developer items (animation and movement testing, DevTools) only appear with
// `npm run dev`. Grows into the full pet menu (Sit, Follow, Sleep...) in Phase 11.

import { app, Menu } from 'electron';

const SPOTS = [
  ['Left edge', 'left'],
  ['Middle', 'middle'],
  ['Right edge', 'right'],
  ['Random spot', 'random'],
];

// Keep the mode ids in sync with MOUSE_MODES in src/renderer/interaction/MouseInteraction.js.
export const MOUSE_MODE_ITEMS = Object.freeze([
  ['Ignore the mouse', 'off'],
  ['Curious (look, get startled)', 'curious'],
  ['Follow the mouse', 'follow'],
  ['Shy (run away)', 'shy'],
]);

export function buildPetMenu({ character, isDev, mouseMode, sendCommand, openDevTools }) {
  const template = [
    { label: character?.name ?? 'Desktop Pet', enabled: false },
    { type: 'separator' },
  ];
  if (isDev) template.push(...developerItems({ character, mouseMode, sendCommand, openDevTools }), { type: 'separator' });
  template.push({ label: 'Quit', click: () => app.quit() });
  return Menu.buildFromTemplate(template);
}

function developerItems({ character, mouseMode, sendCommand, openDevTools }) {
  const items = [];
  if (character) {
    const command = (label, payload) => ({ label, click: () => sendCommand(payload) });
    const spotItems = (run) => SPOTS.map(([label, spot]) => command(label, { type: 'move-to', spot, run }));

    items.push(
      {
        label: 'Mouse',
        submenu: MOUSE_MODE_ITEMS.map(([label, mode]) => ({
          label,
          type: 'radio',
          checked: mode === mouseMode,
          click: () => sendCommand({ type: 'mouse-mode', mode }),
        })),
      },
      {
        label: 'Movement',
        submenu: [
          command('Walk left', { type: 'walk', direction: 'left' }),
          command('Walk right', { type: 'walk', direction: 'right' }),
          command('Run left', { type: 'run', direction: 'left' }),
          command('Run right', { type: 'run', direction: 'right' }),
          command('Stop', { type: 'stop' }),
          { type: 'separator' },
          command('Jump', { type: 'jump' }),
          command('Turn around', { type: 'turn-around' }),
          command('Drop from the top', { type: 'drop' }),
          { type: 'separator' },
          { label: 'Walk to', submenu: spotItems(false) },
          { label: 'Run to', submenu: spotItems(true) },
          { type: 'separator' },
          command('Movement demo', { type: 'movement-demo' }),
        ],
      },
      {
        label: 'Play animation',
        submenu: Object.entries(character.animations).map(([name, animation]) =>
          command(animation.aliasOf ? `${name}  (uses ${animation.aliasOf})` : name, { type: 'play-animation', name })),
      },
      command('Play all animations', { type: 'showcase' }),
    );
  }
  items.push({ label: 'Open DevTools', click: openDevTools });
  return items;
}
