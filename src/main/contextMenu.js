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

const MAX_ICONS_IN_MENU = 15;

export function buildPetMenu({ character, isDev, mouseMode, desktopIcons, sendCommand, openDevTools }) {
  const template = [
    { label: character?.name ?? 'Desktop Pet', enabled: false },
    { type: 'separator' },
  ];
  if (isDev) {
    template.push(...developerItems({ character, mouseMode, desktopIcons, sendCommand, openDevTools }), { type: 'separator' });
  }
  template.push({ label: 'Quit', click: () => app.quit() });
  return Menu.buildFromTemplate(template);
}

// In Windows menus "&" marks a keyboard shortcut letter; "&&" shows a literal "&".
const menuText = (text) => text.replaceAll('&', '&&');

// Icons from the last scan that the pet could visit (not covered, room above).
function iconItems(scan, character, sendCommand) {
  if (!scan) return [{ label: 'Scanning desktop icons...', enabled: false }];
  if (!scan.available) return [{ label: `Unavailable: ${menuText(scan.reason ?? 'unknown')}`.slice(0, 80), enabled: false }];
  if (!scan.visible) return [{ label: 'Desktop icons are hidden', enabled: false }];

  const free = scan.icons
    .filter((icon) => !icon.occluded && icon.y >= character.height + 4)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (free.length === 0) return [{ label: 'No free icons (covered by windows?)', enabled: false }];
  const items = free.slice(0, MAX_ICONS_IN_MENU).map((icon) => ({
    label: menuText(icon.name.length > 40 ? `${icon.name.slice(0, 39)}…` : icon.name),
    click: () => sendCommand({ type: 'visit-icon', id: icon.id }),
  }));
  if (free.length > MAX_ICONS_IN_MENU) items.push({ label: `…and ${free.length - MAX_ICONS_IN_MENU} more`, enabled: false });
  return items;
}

function developerItems({ character, mouseMode, desktopIcons, sendCommand, openDevTools }) {
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
        label: 'Desktop icons',
        submenu: [
          command('Visit a random icon', { type: 'visit-icon', id: 'random' }),
          { type: 'separator' },
          ...iconItems(desktopIcons, character, sendCommand),
          { type: 'separator' },
          command('Hop down', { type: 'leave-icon' }),
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
