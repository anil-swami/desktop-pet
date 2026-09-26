# Desktop Pet

A tiny cartoon creature that lives on your Windows desktop. Built with Electron and vanilla JavaScript.

> **Status:** Phases 1–11 — Pip lives on its own: it wanders, dashes, hops, sits and naps, and hops between desktop icons whenever your desktop is visible. It notices which app you're using, talks in speech and thought bubbles, and you can pet it, feed it, throw it, and tell it to come, sit, sleep or stop.

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
npm run build:helper   # force a rebuild of the Windows helper (normally automatic)
```

`npm start` and `npm run dev` first compile the small Windows helper (`build/windows-helper.exe`) if its source changed. See [Windows helper](#windows-helper).

**Right-click Pip** for the pet menu (see [Interacting with Pip](#interacting-with-pip)). In dev mode the menu also shows energy and mood, and a **Developer** submenu: **Mouse** modes, **Desktop icons**, **Movement**, **Play animation**, **Play all animations**, **Test speech bubble** and **Open DevTools**.

Set the log level explicitly with `PET_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`):

```powershell
$env:PET_LOG_LEVEL = "debug"; npm start
```

**Playing with Pip:** click it, double-click it, rub the cursor back and forth over it to pet it, drag and throw it, or feed it from the menu. Minimise your windows and it goes icon-hopping.

**To quit:** right-click the pet → **Quit**, or press `Ctrl+C` in the terminal that launched it.

## Interacting with Pip

| Do this | Pip |
|---|---|
| Click | happy ("Hehe!"). Four quick pokes: confused |
| Double-click | jumps for joy |
| Rub the cursor back and forth over it (no clicking) | **petting**: hearts, "Purr..." |
| Click while it sleeps | wakes up ("Five more minutes...") |
| Drag and let go / flick | falls, or flies and bounces off the screen edge |
| Move the cursor near it | looks at you |

**The pet menu** (right-click Pip):

| Item | What happens |
|---|---|
| Come here | Pip follows your cursor for a moment: move the mouse where you want it, and it stops once the cursor settles |
| Sit | sits and stays (up to 3 minutes) |
| Follow mouse | keeps following the cursor until unticked |
| Sleep / Wake up | naps until woken (or 5 minutes) / wakes up |
| Run! | zoomies: races to one side of the screen and back |
| Stop | stops everything and stays put for 30 s |
| Pet Pip | hearts and a happy wiggle |
| Feed Pip | a cookie drops nearby; Pip runs over and eats it (energy and mood up) |
| Live on its own | autonomy on/off; menu orders still work when it's off |
| Speech bubbles | bubbles on/off |
| Notice which app I use | app awareness on/off |
| Settings... | Phase 12 |

Any order is cut short by the next order, a click or a drag.

## Build

Not yet. Packaging into a Windows installer is added in a later phase. For now, run from source with `npm start`.

## Project architecture

```text
desktop-pet/
├── main.js                  Entry point: app lifecycle (main process)
├── preload.cjs              The only bridge between the page and the main process
├── scripts/build-helper.mjs Compiles the Windows helper with the C# compiler built into Windows
├── src/
│   ├── main/                Main process (Node.js): windows, OS, IPC
│   │   ├── WindowManager.js     Creates the transparent overlay window, click-through
│   │   ├── DisplayManager.js    Watches the screen; reports work-area changes
│   │   ├── WindowsHelper.js     Runs build/windows-helper.exe; JSON lines over stdin/stdout
│   │   ├── helpers/WindowsHelper.cs  Read-only Windows queries: desktop icons, foreground app
│   │   ├── DesktopIcons.js      Desktop icon scans → window coordinates (no file paths)
│   │   ├── AppAwareness.js      Which app is in front → category (code, browser...)
│   │   ├── UserPresence.js      Is the user at the computer?
│   │   ├── CharacterLoader.js   Reads + validates character.json, fills in fallbacks
│   │   ├── contextMenu.js       Native right-click menu
│   │   ├── ipcHandlers.js       Validates and handles messages from the page
│   │   └── logger.js            Leveled [Pet:scope] logging
│   └── renderer/            Renderer process (Chromium page, no Node.js)
│       ├── renderer.js          Entry point: builds the pet, wires everything, commands
│       ├── core/
│       │   ├── Ticker.js            The single animation loop + timer registry
│       │   ├── Random.js            All randomness, seedable for tests
│       │   └── logger.js            Forwards renderer logs to the terminal
│       ├── character/
│       │   ├── Character.js         The pet as the app sees it (animation, movement, blinking)
│       │   ├── AnimationController.js  Which frame to show, and when (no DOM)
│       │   ├── MovementController.js   Position, walking, jumping, gravity, platforms (no DOM)
│       │   ├── CharacterView.js     The pet's DOM element
│       │   └── EffectsView.js       Hearts and crumbs
│       ├── behavior/
│       │   ├── BehaviorManager.js   The autonomous loop, interruptions, app reactions
│       │   ├── BehaviorScheduler.js Weighted choice with priorities and cooldowns
│       │   ├── Personality.js       Energy, boredom, mood, curiosity
│       │   ├── activities.js        What the pet can decide to do
│       │   └── orders.js            What you can ask it to do (come, sit, feed...)
│       ├── dialogue/
│       │   ├── lines.js             Everything Pip can say, by topic
│       │   ├── DialogueManager.js   When a line may appear: priorities, gaps, cooldowns (no DOM)
│       │   └── BubbleView.js        The bubble element: placement, speech/thought style
│       ├── interaction/
│       │   ├── ClickThrough.js      Clickable pet, click-through everywhere else
│       │   ├── MouseInteraction.js  Cursor, clicks, double-clicks, petting, drag and throw
│       │   ├── DesktopInteraction.js  Visiting desktop icons: walk, leap, sit, hop down
│       │   ├── Treats.js            Treats falling and waiting to be eaten (no DOM)
│       │   └── TreatView.js         The treat's DOM element
│       ├── dev/demos.js         "Play all animations" and "Movement demo"
│       ├── index.html
│       └── styles/              main.css, character.css (pet + motions), bubble.css, effects.css
├── assets/characters/default/   Pip: character.json + 13 SVG frames
├── assets/items/treat.svg   The cookie you can feed Pip
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
| invoke | page → main → page | `ipcRenderer.invoke` / `ipcMain.handle` | Request/response: character, desktop icons, current context |
| push | main → page | `webContents.send` / `ipcRenderer.on` | Menu commands, app switches, "user away" |

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

- **AnimationController** decides which frame is visible from elapsed time (`dt`), handles looping, and switches to the `next` animation when a one-shot ends. `play()` returns a Promise (`true` = finished, `false` = interrupted).
- **CharacterView** is the only code touching the DOM. Flipping left/right is a CSS `scaleX(-1)`.
- **Ticker** is the single `requestAnimationFrame` loop. It **stops entirely** when nothing is animating: a still pose costs zero JavaScript per frame.
- **Motions** (`breathe`, `bob`, `hop`...) are CSS keyframes layered on top of frames. They run on the GPU compositor.
- **Blinking** is scheduled by `Character` while idle, every 2.5–6.5 seconds.

### Movement

`MovementController` owns the pet's position. It never moves an Electron window: the pet element gets a CSS `translate3d`, which the GPU composites without layout.

- **Coordinates** are CSS pixels inside the pet window. `x` is the pet's horizontal centre and `y` is where its feet are. The window covers the work area, so the **floor is the window's bottom edge**: the top of the taskbar.
- **Bounds:** the pet stops at the screen edges, and every target is clamped to the visible area.
- **Physics** uses the exact formulas for constant gravity: `position += velocity·dt + ½·gravity·dt²`, then `velocity += gravity·dt`.
- **Platforms** (desktop icons) are one-way: Pip can jump up through them, lands on them coming down, and falls off their edges.
- **Animations follow movement transitions:** start walking → `walk`, jump → `jump`, airborne without jumping → `fall`, land/arrive/stop → `idle`.
- **The Ticker only runs while the pet moves.**

```js
pet.walk('left');                      // until stop() or the edge
pet.run('right');
pet.stop();
pet.turnAround();
await pet.moveTo(900, { run: true });  // true on arrival, false if interrupted
await pet.jump();                      // true on landing
await pet.jumpTo(300, 150);            // aimed leap, lands exactly there
pet.placeAt(400, 0);                   // teleport; above the floor it falls
```

| Setting | Default | In `MOVEMENT_DEFAULTS` |
|---|---|---|
| Walk speed | 60 px/s | `walkSpeed` |
| Run speed | 190 px/s | `runSpeed` |
| Gravity | 2400 px/s² | `gravity` |
| Jump speed | 600 px/s (≈ 75 px high) | `jumpSpeed` |

These become user settings in Phase 12.

### Autonomous behavior

Pip decides what to do by itself. There's no giant if/else: each **activity** says how much it wants to run right now, and a scheduler rolls a weighted die.

```text
┌─ BehaviorManager loop ───────────────────────────────────────────────┐
│ paused or busy? ─▶ rest                                               │
│ reaction queued? (app switch, user back) ─▶ do that first             │
│ else: build context ─▶ BehaviorScheduler picks ─▶ run the activity    │
│ Personality.spend(activity.kind, seconds it took)                     │
└───────────────────────────────────────────────────────────────────────┘
```

**Personality** (0–100 each, see `Personality.js`): running tires Pip and sitting or sleeping rests it (**energy**). Idling bores it and activity cures that (**boredom**). Clicks and play cheer it up while pokes and hard drops don't (**mood**). New things raise **curiosity**.

**Activities** (see `activities.js`):

| Activity | State | Likely when |
|---|---|---|
| look-around | IDLE | often; turns around now and then |
| wander | WALKING | energetic or bored |
| dash | RUNNING | very energetic (cooldown 20 s) |
| hop | PLAYING | good mood, some energy |
| sit | SITTING | tired, or you're coding or watching something |
| nap | SLEEPING | energy low, or **you're away** (top priority) |
| visit-icon | CURIOUS | **the desktop is visible**: its favourite; top priority right after the desktop appears; leaps straight from icon to icon |

**The scheduler** (`BehaviorScheduler.js`) drops activities still on **cooldown** and keeps only the highest **priority** tier. It then picks by **weight**: an activity with weight 4 is twice as likely as one with weight 2. All randomness goes through one `Random` object, so tests can use a seed and get the same choices every run.

**Orders** (`orders.js`) are what you ask for: come, sit, sleep, run, stop, pet, feed. They're written like activities, but `BehaviorManager.order()` runs them straight away. They skip any pause, run even when autonomy is off, and set their own pause afterwards (`holdMs`, e.g. 30 s after Stop). A treat left on the floor is picked up later by the `eat-leftovers` activity.

**Interruptions:** a click, a drag or a menu command calls `interrupt(reason, pause)`. The running activity's `wait()` resolves `false` and its walk stops, so the activity simply returns. The loop then rests for a few seconds (20 s after a menu command) before choosing again.

**Context changes behavior:**
- **Desktop visible:** icon visits become likely. The moment it appears, they get top priority.
- **A maximized app in front:** all icons are hidden, so Pip doesn't even scan for them.
- **A fullscreen app** (video, game, slides): Pip calms down to sitting and napping.
- **You're away** (no input for 5 minutes, or the screen is locked): Pip naps and wakes up happy when you're back.

The logs show every decision: `State: IDLE → WALKING (wander)`.

### Speech bubbles

Pip talks in small comic bubbles: **speech** (rounded, with a tail) or **thought** (a cloud with little dots, e.g. "Zzz..." while napping).

```js
dialogue.show("I'm bored...");                      // a specific line
dialogue.topic('bored', { priority: 'ambient' });   // a random line from lines.js
dialogue.think('Zzz...');                           // a thought bubble
```

**Not constantly.** `DialogueManager` decides whether a line may appear. Lines that don't pass are dropped, not queued, because a late line is a stale line.

| Priority | Used for | Needs since the last bubble | Same topic again after |
|---|---|---|---|
| `reply` | answering you: clicks, grabs, "Welcome back!" | nothing, shows at once | 1.2 s |
| `event` | app switches, icon moments, "Zzz..." | 4 s | 15 s |
| `ambient` | idle chatter: "I'm bored...", "Wheee!" | 25 s, and only by chance | 90 s |

- A bubble never replaces a more important one.
- A topic never repeats the same line twice in a row.
- A bubble stays up for 2.2–6 s, depending on length.
- **Quiet mode:** while a fullscreen app runs or you're away, only replies appear.
- **Speech bubbles** in the right-click menu turns them off.
- Chattiness becomes a setting in Phase 12.

**Placement and accessibility** (`BubbleView`):
- The bubble lives *inside* the pet element, so it moves with Pip for free.
- Near a screen edge it slides inward, and the tail keeps pointing at Pip. With no room above (e.g. Pip on a high icon), it goes below.
- It is **click-through** (`pointer-events: none`), so it never blocks a click.
- `role="status"` with `aria-live` lets screen readers announce it. It uses dark text on light paper with a strong outline, readable on any wallpaper.
- It honours reduced-motion settings.
- One element is reused for every bubble, with the pop-in and fade done in CSS: no work while no bubble shows.

### App awareness

Pip notices which app is in front and reacts, with cooldowns so it's charming rather than annoying:

| You switch to | Pip | Might say |
|---|---|---|
| A code editor (VS Code, Visual Studio, JetBrains...) | happy, then likes to sit with you | "Back to coding?" |
| A browser | looks around | "What are we reading?" |
| A terminal | surprised | "Hacker mode!" |
| A chat app (WhatsApp, Teams, Slack...) | happy | "Say hi from me!" |
| A newly opened folder window | surprised | "What's in there?" |
| The desktop | happy, then icon-hopping | "Desktop time!" |
| Anything fullscreen | calms down | — |

Each category reacts at most once per 5 minutes (folders every 30 s), and there's at most one reaction per 30 s overall.

**How:** the Windows helper installs a **WinEvent hook** (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`), so Windows *tells* it when the foreground window changes. There's no polling, and nothing runs while nothing changes. `AppAwareness` groups the process name into a category, ignores rapid Alt+Tab bursts (500 ms debounce), and remembers folder windows so only new ones count as "opened". Switch it off with **Notice which app I use** in the right-click menu.

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
| Click | `happy`; 4 pokes within 2.5 s → `confused`; if asleep → `wake` |
| Second click within 350 ms | jump for joy |
| Rubbing: 4 direction changes over the pet within 1.5 s, strokes ≥ 10 px | petting (cooldown 4 s) |
| Press and move 5+ px | Picked up: everything stops, Pip dangles (`fall`) and follows the cursor |
| Let go | Falls with the cursor's last speed: a flick throws it, and it bounces off screen edges |
| Landing after a fall higher than 220 px | Dizzy (`confused`) |

While the mouse is busy with Pip (pressing, dragging, reacting, following), the autonomous behavior waits. All thresholds live in `MOUSE_DEFAULTS` and become settings in Phase 12.

### Desktop icons

Pip can walk to a desktop icon, leap on top of it and sit there, and leap from icon to icon. It **only looks at icons**: nothing in the app can open, move, rename or change a file.

**How icon positions are read.** Windows has no simple API for this. The documented way is the Shell COM API: `IShellWindows` → desktop `IShellBrowser` → `IShellView` → `IFolderView.GetItemPosition`. The [Windows helper](#windows-helper) does it.

- **Read-only by construction:** the C# interfaces declare only read methods. `SelectAndPositionItems` (which moves icons) and `SetNameOf` (which renames) are not declared, so they cannot be called.
- **No file paths leave the helper:** it turns each path into an anonymous id (a hash).
- **"Covered" check:** the helper lists visible windows' **rectangles only** (never titles or contents). Pip only visits icons no window is covering.

**Icons are platforms.** Icons usually sit far above the taskbar, so they become one-way platforms in `MovementController`, and Pip reaches them with an aimed leap:

```text
scan ─▶ pick a free icon ─▶ walk to a take-off spot beside it ─▶ leap (jumpTo) ─▶ sit
      ─▶ on an icon already? leap straight across to the next one
      ─▶ every second: still on it?   every 5 s: rescan — moved, covered or hidden? ─▶ hop down
      ─▶ icon deleted? the platform vanishes and Pip falls
```

`jumpTo(x, y)` solves the jump from physics: apex height → launch speed `√(2·g·h)` → flight time → horizontal speed. It also corrects for the exact touchdown moment within a frame, so the landing is on target at any frame rate.

### Windows helper

Some things the pet needs are Windows APIs that Node can't call directly: desktop icon positions (Shell COM) and being told when the active window changes (`SetWinEventHook`). They live in one small C# program, [`WindowsHelper.cs`](src/main/helpers/WindowsHelper.cs).

- **No extra tools or packages:** `scripts/build-helper.mjs` compiles it with the C# compiler that ships with Windows (.NET Framework 4, `csc.exe`). It runs automatically before `npm start` / `npm run dev`, and only when the source changed. The output (`build/`) is not committed.
- **Small and quick:** about **12–14 MB** of memory and ~0.2 s to start. (A first version hosted the same code in PowerShell: 64 MB and 1.4 s. When app awareness made it run permanently, it was worth compiling.)
- **Protocol:** JSON lines over stdin/stdout. `{"id":1,"command":"desktop-icons"}` in, `{"id":1,"ok":true,"result":...}` out, plus `{"event":"foreground",...}` lines while watching.
- **Lifecycle** (`WindowsHelper.js`): starts on first use and stays running while app awareness watches. It is restarted and re-subscribed after a crash (giving up after 3 crashes in a minute), and it exits by itself when the app quits or crashes, because its input closes.
- If it can't run (not built, blocked by policy), icon visits and app awareness report "unavailable" and everything else keeps working.

### Display handling

The pet lives on the **primary display's work area** (the screen minus the taskbar).

**DIPs, not pixels.** Electron measures in *device-independent pixels*. At 125% scaling, a 1920×1080 panel is 1536×864 DIPs. Window bounds, CSS pixels and `screen` values all use DIPs, so scaling is mostly automatic. Physical pixels matter in two places: `CharacterView` snaps the pet to whole device pixels so it stays sharp, and the Windows helper reports physical pixels that `screen.screenToDipRect()` converts.

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
Pet is pulled back inside; if the floor dropped away (e.g. taskbar auto-hide), it falls.
```

**Multi-monitor is intentionally not supported.** The pet always stays on the primary screen and never walks between monitors. If a second screen is plugged in or removed, the pet window just re-fits the primary display.

## Adding a behavior

An activity is one object in [`activities.js`](src/renderer/behavior/activities.js). For example, a stretch when Pip has been still for a while:

```js
{
  name: 'stretch',
  state: 'PLAYING',          // shown in logs and the menu
  kind: 'play',              // how it changes personality (see RATES in Personality.js)
  cooldownMs: 30_000,        // at most every 30 s
  weight: ({ personality: p, calm }) => (calm ? 0 : p.boredom / 40), // 0 = never
  async run({ character, wait }) {
    await character.play('happy');           // any animation the character has
    if (!(await wait(1500))) return;         // wait() is false when interrupted: just return
    await character.moveTo(character.position.x + 40);
  },
},
```

- `weight(context)` gets `{ personality, freeIcons, onIcon, desktopFresh, userAway, calm, app }`.
- Optional `priority(context)`: a higher number beats all normal activities. `nap` uses 3 when you're away.
- Optional `needsFloor: true`: hop down from an icon first.
- Always `return` when `wait()` resolves `false`, or when a `moveTo`/`jump` promise does.

Behaviors are tested in plain Node with a seeded `Random` and a fake clock (see `tests/behaviorManager.test.js`).

Activities can also talk: `run({ say, think })`, e.g. `say('bored', { chance: 0.5 })`. Lines offered this way are idle chatter (`ambient`), so the dialogue rules often keep them quiet. That's intended.

## Adding a dialogue

All lines live in [`lines.js`](src/renderer/dialogue/lines.js), grouped by topic:

```js
iconSit: ['Comfy!', 'Nice spot!', 'Ooh, "{name}"!'],
```

- **More variety:** add a line to an existing topic. It's picked at random, never twice in a row.
- **Placeholders:** `{name}` is filled in by the caller (long values are shortened). Lines whose values weren't given are skipped automatically.
- **A new topic:** add it to `lines.js`, then ask for it where it should happen:
  - in an activity: `say('myTopic', { chance: 0.3 })`
  - for a user reaction in `renderer.js`: `dialogue.topic('myTopic', { priority: 'reply' })`
  - for an app reaction: `topic: 'myTopic'` in `APP_REACTIONS` (BehaviorManager.js)
- Pick the priority by who it's for: `reply` answers the user, `event` comments on something that happened, `ambient` is idle chatter.

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
- The preload exposes six functions on `window.desktopPet`, and copies only known fields from anything the page sends.
- Every IPC handler checks the sender is the pet window and validates argument types.
- A Content-Security-Policy restricts the page to bundled files. Navigation and popups are blocked.
- Character files are read by the main process only. Frame paths cannot leave their character folder.
- The Windows helper is built locally from the source in this repo, receives only fixed command names, and never gets input from the page.

## Privacy: what the app reads from Windows

| Feature | What is read | What is never read |
|---|---|---|
| Mouse interaction | Cursor position above the taskbar, while the app runs | Clicks in other apps, keystrokes |
| Display handling | Screen size, work area, scaling | — |
| Desktop icons | Icon names, kinds and positions; rectangles of windows covering them | File contents, file paths (hashed in the helper), window titles or contents |
| App awareness (can be switched off) | The foreground app's **process file name** (e.g. `Code.exe`); desktop / folder window / app; maximized or fullscreen | Window titles, document names, URLs, anything inside apps |
| Away detection | Seconds since the last input anywhere (one number); screen lock and sleep events | Which keys or buttons were used |

Everything stays on your PC and in memory: nothing is logged in bulk, stored or sent anywhere.

## Windows notes and troubleshooting

- **`does not provide an export named 'BrowserWindow'`**: the environment variable `ELECTRON_RUN_AS_NODE=1` is set, which makes Electron behave like plain Node. It is inherited when a process is launched from a VS Code *extension* (not the integrated terminal). Clear it with `Remove-Item Env:ELECTRON_RUN_AS_NODE` and try again.
- **Black box instead of a transparent background**: some GPU drivers mishandle transparent windows. Update your graphics driver.
- **"Windows helper unavailable"**: run `npm run build:helper` and check its output. It needs `csc.exe` from the .NET Framework 4, which is part of Windows 10/11.
- **Multiple monitors**: not supported by design. The pet stays on the primary display.
- **Cursor over the taskbar**: the pet window doesn't cover the taskbar, so Pip can't see the cursor there.
- **Looking at the cursor** is left/right only. Frame-based art has no separate eyes or head to aim.
- **Desktop icons covered by windows** are not visited: Windows only shows them when the desktop is visible. Minimise windows (Win+M) to give Pip access.
- **Icons in the top row** are skipped: Pip would stick out above the screen.
- **"Show desktop icons" turned off** (right-click the desktop → View) means there's nothing to visit.
- **Apps running as administrator** may be reported without a name, and are then treated as "other".
- **Fullscreen apps**: the pet is always on top, so it still shows over fullscreen videos and games, but it calms down. Hiding it completely is a Phase 12 setting.

## Roadmap

1. ✅ Basic desktop pet: transparent frameless window
2. ✅ Character animation system
3. ✅ Desktop movement
4. ✅ Display handling: resolution, scaling, taskbar and sleep changes (single screen; multi-monitor intentionally skipped)
5. ✅ Mouse interaction
6. ✅ Desktop icons (visit, sit on, hop between; read-only)
7. ✅ Application window awareness
8. ✅ Personality engine
9. ✅ Autonomous behavior (8 and 9 were brought forward together with 7)
10. ✅ Speech bubbles
11. ✅ Character interaction and pet menu
12. Settings
13. System tray
14. Start with Windows
15. Performance pass
