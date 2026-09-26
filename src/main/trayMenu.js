// The tray icon's menu, as a plain template (no Electron import, so it's
// unit-tested directly). TrayManager turns it into a real menu.
//
//   Pip · paused
//   ─────────────
//   Pause Pip / Resume Pip      (the one that applies is enabled)
//   Hide Pip / Show Pip
//   ─────────────
//   Settings...
//   ─────────────
//   Change character ▸
//   ─────────────
//   Exit

const menuText = (text) => String(text).replaceAll('&', '&&'); // "&" marks a shortcut letter in Windows menus

export function trayMenuTemplate({ name, paused, hidden, characters, currentCharacter, actions }) {
  const who = menuText(name);
  const state = hidden ? ' · hidden' : paused ? ' · paused' : '';
  return [
    { label: `${who}${state}`, enabled: false },
    { type: 'separator' },
    { label: `Pause ${who}`, enabled: !paused, click: actions.pause },
    { label: `Resume ${who}`, enabled: paused, click: actions.resume },
    hidden ? { label: `Show ${who}`, click: actions.show } : { label: `Hide ${who}`, click: actions.hide },
    { type: 'separator' },
    { label: 'Settings...', click: actions.openSettings },
    { type: 'separator' },
    {
      label: 'Change character',
      enabled: characters.length > 0,
      submenu: characters.map(([id, characterName]) => ({
        label: menuText(characterName),
        type: 'radio',
        checked: id === currentCharacter,
        click: () => actions.changeCharacter(id),
      })),
    },
    { type: 'separator' },
    { label: 'Exit', click: actions.exit },
  ];
}

export function trayTooltip({ name, paused, hidden }) {
  if (hidden) return `${name} (hidden) — click for the menu`;
  if (paused) return `${name} (paused) — click for the menu`;
  return `${name} — your desktop pet`;
}
