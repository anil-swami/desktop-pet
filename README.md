# Desktop Pet

A tiny cartoon creature that lives on your Windows desktop. Built with Electron and vanilla JavaScript.

> **Status:** Phase 2 — a data-driven animation system with 12 animations. Pip still stands in one place on the taskbar; walking arrives in Phase 3.

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
npm run dev        # debug logging + developer items in the right-click menu
npm test           # unit tests (Node's built-in test runner, no extra dependencies)
```

In dev mode, right-click the pet for **Play animation**, **Play all animations**, **Turn around** and **Open DevTools**.

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
│   │   ├── CharacterLoader.js   Reads + validates character.json, fills in fallbacks
│   │   ├── contextMenu.js       Native right-click menu
│   │   ├── ipcHandlers.js       Validates and handles messages from the page
│   │   └── logger.js            Leveled [Pet:scope] logging
│   └── renderer/            Renderer process (Chromium page, no Node.js)
│       ├── renderer.js          Entry point: builds the pet, click-through, commands
│       ├── core/
│       │   ├── Ticker.js            The single animation loop + timer registry
│       │   └── logger.js            Forwards renderer logs to the terminal
│       ├── character/
│       │   ├── Character.js         The pet as the app sees it (animation, direction, blinking)
│       │   ├── AnimationController.js  Which frame to show, and when (no DOM)
│       │   └── CharacterView.js     The only DOM code for the pet
│       ├── dev/showcase.js      "Play all animations" helper
│       ├── index.html
│       └── styles/              main.css (page), character.css (pet + motions)
├── assets/characters/default/   Pip: character.json + 13 SVG frames
└── tests/                   Unit tests (node --test)
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

Three IPC styles are used:

| Style | Direction | API | Used for |
|---|---|---|---|
| send | page → main | `ipcRenderer.send` / `ipcMain.on` | Fire-and-forget: click-through, logs, show menu |
| invoke | page → main → page | `ipcRenderer.invoke` / `ipcMain.handle` | Request/response: `await desktopPet.getCharacter()` |
| push | main → page | `webContents.send` / `ipcRenderer.on` | Commands from the menu (later the tray) |

### Why one big transparent window?

The pet window covers the whole **work area** (the screen minus the taskbar) but is fully transparent and **click-through**: clicks pass straight to whatever is underneath. The pet is just a DOM element inside the page.

The alternative, a small window the size of the pet that moves around, means moving an OS window up to 60 times per second and clipping speech bubbles. With one overlay, movement is a cheap CSS `transform`.

Click-through works like this:

1. The window ignores the mouse by default (`setIgnoreMouseEvents(true, { forward: true })`). `forward` means the page still *sees* mouse movement.
2. When the cursor moves onto the pet, the page asks main to accept clicks.
3. When it moves off, clicks pass through again.
4. IPC is only sent when the state flips, not on every mouse move.

If the page crashes or hangs while accepting clicks, the main process restores click-through so the invisible window can never block your desktop.

### The animation system

Artwork is **data**, animation logic is **code**, and the two only meet through `character.json`.

```text
character.json ──CharacterLoader (main)──▶ validated data ──invoke──▶ renderer
                                                                         │
Ticker (rAF loop) ──dt──▶ AnimationController ──"show frame X"──▶ CharacterView ──▶ <img>
```

- **AnimationController** decides which frame is visible from elapsed time (`dt`), handles looping, and switches to the `next` animation when a one-shot ends. `play()` returns a Promise (`true` = finished, `false` = interrupted), so later behaviors can write `await pet.play('jump')`.
- **CharacterView** is the only code touching the DOM. Flipping left/right is a CSS `scaleX(-1)`.
- **Ticker** is the single `requestAnimationFrame` loop. It **stops entirely** when nothing is animating: a still idle pose costs zero JavaScript per frame.
- **Motions** (`breathe`, `bob`, `hop`...) are CSS keyframes layered on top of frames. They run on the GPU compositor.
- **Blinking** is scheduled by `Character` while idle, every 2.5–6.5 seconds.

## Adding a character

1. Create a folder `assets/characters/<id>/` (`id`: letters, digits, `-` or `_`).
2. Add your frames: `.png`, `.svg`, `.webp`, `.gif` or `.jpg`, with transparent backgrounds, all drawn facing the same way.
3. Add `character.json`:

```json
{
  "name": "Robo",
  "size": { "width": 96, "height": 96 },
  "facing": "right",
  "animations": {
    "idle":  { "frames": ["idle.png"], "motion": "breathe" },
    "walk":  { "frames": ["walk-1.png", "walk-2.png", "walk-3.png"], "fps": 8 },
    "happy": { "frames": [{ "src": "happy.png", "ms": 900 }], "motion": "hop" },
    "wave":  { "frames": ["wave-1.png", "wave-2.png"], "fps": 4, "loop": false, "next": "idle" }
  }
}
```

4. Temporarily change `CHARACTER_ID` in `main.js` (a setting in Phase 12), run `npm run dev`, and right-click → **Play all animations**.

| Field | Meaning |
|---|---|
| `facing` | Direction your art faces. The engine mirrors it for the other side. |
| `frames` | File names relative to the folder, or `{ "src", "ms" }` for a per-frame duration. |
| `fps` | Frame rate when a frame has no `ms` (default 8). |
| `loop` | Repeat forever, or play once. Defaults depend on the animation (see below). |
| `next` | Animation to play after a one-shot ends. |
| `motion` | Optional CSS effect: `breathe`, `breathe-slow`, `bob`, `bounce`, `hop`, `jolt`, `tilt`, `flail`. |

**Only `idle` is required.** Missing standard animations borrow frames from a fallback but keep their own timing rules:

| Animation | Default | Falls back to |
|---|---|---|
| `idle` | loop | *(required)* |
| `blink` | once → idle | idle (blinking is then disabled) |
| `walk` | loop | idle |
| `run` | loop | walk |
| `sit` | loop | idle |
| `sleep` | loop | sit |
| `wake` | once → idle | blink |
| `jump` | once, holds last frame | idle |
| `fall` | loop | jump |
| `happy`, `surprised`, `confused` | once → idle | idle |

Extra animations with your own names (like `wave`) are allowed and default to *once → idle*.

Invalid frames (missing file, wrong type, or a path outside the folder) are skipped with a warning in the terminal. The fallback then takes over, so a broken character never crashes the pet.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`: the page has no Node.js access.
- The preload exposes only five functions on `window.desktopPet`.
- Every IPC handler checks the sender is the pet window and validates argument types.
- Character files are read by the main process only. Frame paths cannot leave their character folder.
- A Content-Security-Policy restricts the page to bundled files. Navigation and popups are blocked.

## Windows notes and troubleshooting

- **`does not provide an export named 'BrowserWindow'`**: the environment variable `ELECTRON_RUN_AS_NODE=1` is set, which makes Electron behave like plain Node. It is inherited when a process is launched from a VS Code *extension* (not the integrated terminal). Clear it with `Remove-Item Env:ELECTRON_RUN_AS_NODE` and try again.
- **Black box instead of a transparent background**: some GPU drivers mishandle transparent windows. Update your graphics driver.
- **Display changes**: the window is sized to the primary display at launch. Resolution, taskbar and monitor changes are handled in Phase 4. Until then, restart the pet after changing them.

## Roadmap

1. ✅ Basic desktop pet: transparent frameless window
2. ✅ Character animation system
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
