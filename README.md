# Desktop Pet

A tiny cartoon creature that lives on your Windows desktop. Built with Electron and vanilla JavaScript.

> **Status:** Phase 6 — Pip reacts to your cursor, can be dragged and thrown, and can leap onto desktop icons and sit on them (dev menu). Walking around on its own arrives with the behavior engine in Phases 8–9.

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

In dev mode, right-click the pet for **Mouse** (ignore / curious / follow / shy), **Desktop icons** (visit one, hop down), **Movement** (walk, run, stop, jump, turn around, drop from the top, walk/run to a spot, movement demo), **Play animation**, **Play all animations** and **Open DevTools**.

Set the log level explicitly with `PET_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`):

```powershell
$env:PET_LOG_LEVEL = "debug"; npm start
```

**Playing with Pip:** move the cursor near it and it looks at you. Click it and it's happy (poke it too often and it's confused). Drag it up and let go and it falls, or flick it and it flies and bounces off the screen edge.

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
│   │   ├── DisplayManager.js    Watches the screen; reports work-area changes
│   │   ├── WindowsHelper.js     Runs helpers/windows-helper.ps1; JSON over stdin/stdout
│   │   ├── DesktopIcons.js      Desktop icon scans → window coordinates (no file paths)
│   │   ├── helpers/windows-helper.ps1  Read-only Windows shell queries (PowerShell + C#)
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
│       │   ├── Character.js         The pet as the app sees it (animation, movement, blinking)
│       │   ├── AnimationController.js  Which frame to show, and when (no DOM)
│       │   ├── MovementController.js   Position, walking, running, jumping, gravity (no DOM)
│       │   └── CharacterView.js     The only DOM code for the pet
│       ├── interaction/
│       │   ├── ClickThrough.js      Clickable pet, click-through everywhere else
│       │   ├── MouseInteraction.js  Noticing the cursor, clicks, drag and throw
│       │   └── DesktopInteraction.js  Visiting desktop icons: walk, leap, sit, hop down
│       ├── dev/demos.js         "Play all animations" and "Movement demo"
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
5. The pet can walk out from under a still cursor, and no mouse event fires then. So while the cursor is over the pet, `ClickThrough` re-checks each frame what is under it.

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

### Movement

`MovementController` owns the pet's position. It never moves an Electron window: the pet element gets a CSS `translate3d`, which the GPU composites without layout.

- **Coordinates** are CSS pixels inside the pet window. `x` is the pet's horizontal centre and `y` is where its feet are. The window covers the work area, so the **ground is the window's bottom edge**: the top of the taskbar.
- **Bounds:** the pet stops at the screen edges, and every target is clamped to the visible area.
- **Physics** per frame: `velocity += gravity × dt`, then `position += velocity × dt`.
- **Animations follow movement transitions:** start walking → `walk`, jump → `jump`, airborne without jumping → `fall`, land/arrive/stop → `idle`.
- **The Ticker only runs while the pet moves.** Standing still costs no JavaScript per frame.

```js
pet.walk('left');                  // until stop() or the edge
pet.run('right');
pet.stop();
pet.turnAround();
await pet.moveTo(900, { run: true });  // true on arrival, false if interrupted
await pet.jump();                  // true on landing
pet.placeAt(400, 0);               // teleport; above the ground it falls
```

| Setting | Default | In `MOVEMENT_DEFAULTS` |
|---|---|---|
| Walk speed | 60 px/s | `walkSpeed` |
| Run speed | 190 px/s | `runSpeed` |
| Gravity | 2400 px/s² | `gravity` |
| Jump speed | 600 px/s (≈ 75 px high) | `jumpSpeed` |

These become user settings in Phase 12.

### Mouse interaction

**Where the data comes from:** the main process forwards mouse *moves* to the pet window even while it is click-through, so the page knows where the cursor is anywhere above the taskbar. It never sees clicks meant for other apps. Cursor positions stay in memory and are never logged or sent anywhere.

```text
cursor within 220 px ─▶ noticed ─▶ Pip looks toward it (at most every 1.2 s, only when not busy)
       │                          (forgotten again beyond 300 px, so no flicker at the edge)
       ▼ what happens next depends on the mouse mode
curious (default) ─▶ a fast dash close by startles it (surprised; then not again for 10 s)
follow            ─▶ walks or runs underneath; jumps if the cursor is just above its head
shy               ─▶ runs away when the cursor gets close; if cornered, dashes past it
off               ─▶ nothing
```

| Input | Reaction |
|---|---|
| Click | `happy`; 4 pokes within 2.5 s → `confused` |
| Press and move 5+ px | Picked up: everything stops, Pip dangles (`fall`) and follows the cursor |
| Let go | Falls with the cursor's last speed: a flick throws it, and it bounces off screen edges |
| Landing after a fall higher than 220 px | Dizzy (`confused`) |
| After a click or a drop | Carries on walking or running if that's what it was doing |

**Performance:**
- Proximity is checked at most 10 times per second while the mouse moves.
- A 150 ms re-check timer runs only while the cursor is near Pip or Follow mode is on. With the cursor far away, nothing runs.
- During a drag, `ClickThrough.hold()` keeps the window accepting the mouse, and pointer capture keeps events coming even when the cursor races ahead of Pip.

All thresholds live in `MOUSE_DEFAULTS` and become settings in Phase 12.

### Desktop icons

Pip can walk to a desktop icon, leap on top of it and sit there. It **only looks at icons**: nothing in the app can open, move, rename or change a file.

**How icon positions are read.** Windows has no simple API for this. The documented way is the Shell COM API: `IShellWindows` → desktop `IShellBrowser` → `IShellView` → `IFolderView.GetItemPosition`. Node can't call COM directly, and a native addon would need C++ build tools. So a small helper script, [`windows-helper.ps1`](src/main/helpers/windows-helper.ps1), uses PowerShell and C#, which are built into every Windows 10/11 PC. **No npm dependency was added.**

```text
main process ── {"id":1,"command":"desktop-icons"} ──▶ PowerShell helper (C# compiled once, ~1 s)
             ◀── {"id":1,"ok":true,"result":{...}} ──  names, kinds, rectangles, covered?
```

- The helper starts on first use, stays running for fast answers, and **stops after 2 idle minutes**. It exits by itself if the app quits or crashes, because its input closes.
- **Read-only by construction:** the C# interfaces declare only read methods. `SelectAndPositionItems` (which moves icons) and `SetNameOf` (which renames) are not declared, so they cannot be called.
- **No file paths leave the helper:** it turns each path into an anonymous id (a hash).
- **"Covered" check:** the helper lists visible windows' **rectangles only** (never titles or contents). Pip only visits icons no window is covering.
- If the helper can't run (e.g. PowerShell locked down by company policy), desktop icon features report "unavailable" and everything else keeps working.

**Icons are platforms.** Icons usually sit far above the taskbar, so they become one-way platforms in `MovementController`, and Pip reaches them with an aimed leap:

```text
scan ─▶ pick a free icon ─▶ walk to a take-off spot beside it ─▶ leap (jumpTo) ─▶ sit
      ─▶ every second: still on it?   every 5 s: rescan — moved, covered or hidden? ─▶ hop down
      ─▶ icon deleted? the platform vanishes and Pip falls
```

`jumpTo(x, y)` solves the jump from physics: apex height → launch speed `√(2·g·h)` → flight time → horizontal speed. It also corrects for the exact touchdown moment within a frame, so the landing is on target at any frame rate.

### Display handling

The pet lives on the **primary display's work area** (the screen minus the taskbar).

**DIPs, not pixels.** Electron measures in *device-independent pixels*. At 125% scaling, a 1920×1080 panel is 1536×864 DIPs. Window bounds, CSS pixels and `screen` values all use DIPs, so scaling is mostly automatic. The one place physical pixels matter is `CharacterView`, which snaps the pet to whole device pixels so it stays sharp.

**When the display changes, the window follows:**

```text
Windows changes resolution / scaling / taskbar / wakes from sleep
      │  screen 'display-metrics-changed', 'display-added/removed', powerMonitor 'resume'
      ▼
DisplayManager ── waits 250 ms for the burst to settle, re-reads the primary display,
      │           ignores "changes" that change nothing, keeps the old area if Windows
      │           briefly reports an unusable one
      ▼
WindowManager.fitTo(workArea) ──▶ page 'resize' event ──▶ character.setArea()
      ▼
Pet is pulled back inside; if the ground dropped away (e.g. taskbar auto-hide), it falls.
```

**Multi-monitor is intentionally not supported.** The pet always stays on the primary screen and never walks between monitors. If a second screen is plugged in or removed, the pet window just re-fits the primary display.

## Adding a character

1. Create a folder `assets/characters/<id>/` (`id`: letters, digits, `-` or `_`).
2. Add your frames: `.png`, `.svg`, `.webp`, `.gif` or `.jpg`, with transparent backgrounds, all drawn facing the same way. SVG stays sharp at any scaling. For bitmaps, draw at least **2× the display size** (e.g. 192×192 for a 96×96 pet) so they look crisp at 125–200% scaling.
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
- The Windows helper is started by its full path (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), receives only fixed command names, and never gets input from the page.

## Privacy: what the app reads from Windows

| Feature | What is read | What is never read |
|---|---|---|
| Mouse interaction | Cursor position above the taskbar, while the app runs | Clicks in other apps, keystrokes |
| Display handling | Screen size, work area, scaling | — |
| Desktop icons | Icon names, kinds and positions; rectangles of windows covering them | File contents, file paths (hashed in the helper), window titles or contents |

Everything stays on your PC and in memory: nothing is logged in bulk, stored or sent anywhere.
- A Content-Security-Policy restricts the page to bundled files. Navigation and popups are blocked.

## Windows notes and troubleshooting

- **`does not provide an export named 'BrowserWindow'`**: the environment variable `ELECTRON_RUN_AS_NODE=1` is set, which makes Electron behave like plain Node. It is inherited when a process is launched from a VS Code *extension* (not the integrated terminal). Clear it with `Remove-Item Env:ELECTRON_RUN_AS_NODE` and try again.
- **Black box instead of a transparent background**: some GPU drivers mishandle transparent windows. Update your graphics driver.
- **Multiple monitors**: not supported by design. The pet stays on the primary display.
- **Cursor over the taskbar**: the pet window doesn't cover the taskbar, so Pip can't see the cursor there.
- **Looking at the cursor** is left/right only. Frame-based art has no separate eyes or head to aim.
- **Desktop icons covered by windows** are not visited: Windows only shows them when the desktop is visible. Minimise windows (or use the "show desktop" corner of the taskbar) to give Pip access.
- **Icons in the top row** are skipped: Pip would stick out above the screen.
- **"Show desktop icons" turned off** (right-click the desktop → View) means there's nothing to visit.
- **Locked-down PCs**: if PowerShell is restricted by policy (Constrained Language Mode), the icon features are unavailable.
- **Reacting when a folder is opened** needs window awareness and comes in Phase 7.
- **Fullscreen apps**: the pet is always on top, so it also shows over fullscreen videos and games. Settings for this come in Phase 12.

## Roadmap

1. ✅ Basic desktop pet: transparent frameless window
2. ✅ Character animation system
3. ✅ Desktop movement
4. ✅ Display handling: resolution, scaling, taskbar and sleep changes (single screen; multi-monitor intentionally skipped)
5. ✅ Mouse interaction
6. ✅ Desktop icons (visit, sit on, hop down; read-only)
7. Application window awareness
8. Personality engine
9. Autonomous behavior
10. Speech bubbles
11. Character interaction and pet menu
12. Settings
13. System tray
14. Start with Windows
15. Performance pass
