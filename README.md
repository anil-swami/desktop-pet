# Desktop Pet

A tiny cartoon creature that lives on your Windows desktop. Built with Electron and vanilla JavaScript.

> **Status:** Phase 1 — a transparent, click-through window with a placeholder character parked on the taskbar.

## Requirements

- Windows 10/11
- Node.js 20+ (developed on Node 24)

## Installation

```bash
npm install
```

## Development

```bash
npm start          # run the pet
npm run dev        # run with debug logging + detached DevTools for the pet page
```

Set the log level explicitly with `PET_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`):

```powershell
$env:PET_LOG_LEVEL = "debug"; npm start
```

**To quit:** right-click the pet → **Quit**, or press `Ctrl+C` in the terminal that launched it.

## Build

Not yet. Packaging into a Windows installer is added in a later phase. For now, run from source with `npm start`.

## Project architecture

```text
desktop-pet/
├── main.js                  Entry point: app lifecycle (main process)
├── preload.cjs              The only bridge between the page and the main process
├── src/
│   ├── main/                Main process (Node.js): windows, OS, IPC
│   │   ├── WindowManager.js     Creates the transparent overlay window, click-through
│   │   ├── ipcHandlers.js       Validates and handles messages from the page
│   │   └── logger.js            Leveled [Pet:scope] logging
│   └── renderer/            Renderer process (Chromium page, no Node.js)
│       ├── index.html
│       ├── renderer.js          Hover detection → click-through toggle, right-click menu
│       └── styles/main.css
└── assets/characters/default/pet.svg   Placeholder character
```

### The two kinds of process

Electron apps have **one main process** and **one renderer process per window**.

| | Main process | Renderer process |
|---|---|---|
| Runs | `main.js` and `src/main/` | `src/renderer/` |
| Is | A Node.js program | A Chromium web page |
| Can | Create windows, talk to Windows, read files | Draw the pet with HTML/CSS/JS |
| Cannot | Touch the DOM | Use Node.js (by design, for security) |

They communicate with **IPC** (inter-process communication): named messages sent between processes. The page calls `window.desktopPet.someMethod()`, which the preload script turns into an IPC message. The main process validates it and acts on it.

```text
renderer.js ──window.desktopPet.setClickThrough(false)──▶ preload.cjs
preload.cjs ──ipcRenderer.send('pet:set-click-through')──▶ ipcHandlers.js
ipcHandlers.js ──validates sender + type──▶ WindowManager.setClickThrough()
```

### Why one big transparent window?

The pet window covers the whole **work area** (the screen minus the taskbar) but is fully transparent and **click-through**: clicks pass straight to whatever is underneath. The pet is just a DOM element inside the page.

The alternative, a small window the size of the pet that moves around, means moving an OS window up to 60 times per second and clipping speech bubbles. With one overlay, movement is a cheap CSS `transform`.

Click-through works like this:

1. The window ignores the mouse by default (`setIgnoreMouseEvents(true, { forward: true })`). `forward` means the page still *sees* mouse movement.
2. When the cursor moves onto the pet, the page asks main to accept clicks.
3. When it moves off, clicks pass through again.
4. IPC is only sent when the state flips, not on every mouse move.

If the page crashes or hangs while accepting clicks, the main process restores click-through so the invisible window can never block your desktop.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`: the page has no Node.js access.
- The preload exposes only three functions on `window.desktopPet`.
- Every IPC handler checks the sender is the pet window and validates argument types.
- A Content-Security-Policy restricts the page to bundled files. Navigation and popups are blocked.

## Windows notes and troubleshooting

- **`does not provide an export named 'BrowserWindow'`**: the environment variable `ELECTRON_RUN_AS_NODE=1` is set, which makes Electron behave like plain Node. It is inherited when a process is launched from a VS Code *extension* (not the integrated terminal). Clear it with `Remove-Item Env:ELECTRON_RUN_AS_NODE` and try again.
- **Black box instead of a transparent background**: some GPU drivers mishandle transparent windows. Update your graphics driver.
- **Display changes**: the window is sized to the primary display at launch. Resolution, taskbar and monitor changes are handled in Phase 4. Until then, restart the pet after changing them.

## Roadmap

1. ✅ Basic desktop pet: transparent frameless window
2. Character animation system
3. Desktop movement
4. Multi-monitor support
5. Mouse interaction
6. Desktop icons and folders
7. Application window awareness
8. Personality engine
9. Autonomous behavior
10. Speech bubbles
11. Character interaction and pet menu
12. Settings
13. System tray
14. Start with Windows
15. Performance pass
