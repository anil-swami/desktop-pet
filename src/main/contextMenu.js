// Builds the native right-click menu for the pet.
// Developer items (animation testing, DevTools) only appear with `npm run dev`.
// Grows into the full pet menu (Sit, Follow, Sleep...) in Phase 11.

import { app, Menu } from 'electron';

export function buildPetMenu({ character, isDev, sendCommand, openDevTools }) {
  const template = [
    { label: character?.name ?? 'Desktop Pet', enabled: false },
    { type: 'separator' },
  ];
  if (isDev) template.push(...developerItems({ character, sendCommand, openDevTools }), { type: 'separator' });
  template.push({ label: 'Quit', click: () => app.quit() });
  return Menu.buildFromTemplate(template);
}

function developerItems({ character, sendCommand, openDevTools }) {
  const items = [];
  if (character) {
    items.push(
      {
        label: 'Play animation',
        submenu: Object.entries(character.animations).map(([name, animation]) => ({
          label: animation.aliasOf ? `${name}  (uses ${animation.aliasOf})` : name,
          click: () => sendCommand({ type: 'play-animation', name }),
        })),
      },
      { label: 'Play all animations', click: () => sendCommand({ type: 'showcase' }) },
      { label: 'Turn around', click: () => sendCommand({ type: 'turn-around' }) },
    );
  }
  items.push({ label: 'Open DevTools', click: openDevTools });
  return items;
}
