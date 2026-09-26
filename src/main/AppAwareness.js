// Which app is in front, so the pet can react ("Back to coding?").
//
// Privacy: the Windows helper reports only the foreground window's process FILE
// NAME (e.g. "Code.exe"), a coarse kind (app / desktop / folder window), and
// whether it is maximized or fullscreen. Window titles and contents are never
// read. Nothing is stored or sent anywhere; it can be switched off.
//
// Raw events are debounced (Alt+Tab fires several in a row) and de-duplicated,
// then turned into { category, app, maximized, fullscreen, newFolder }.

export const APP_CATEGORIES = Object.freeze({
  code: ['code.exe', 'code - insiders.exe', 'cursor.exe', 'devenv.exe', 'idea64.exe', 'webstorm64.exe',
    'pycharm64.exe', 'rider64.exe', 'sublime_text.exe', 'notepad++.exe', 'zed.exe', 'android studio.exe', 'studio64.exe'],
  browser: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe'],
  terminal: ['windowsterminal.exe', 'wt.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wsl.exe', 'mintty.exe'],
  chat: ['whatsapp.exe', 'whatsapp.root.exe', 'teams.exe', 'ms-teams.exe', 'slack.exe', 'discord.exe', 'telegram.exe', 'zoom.exe'],
  media: ['vlc.exe', 'spotify.exe', 'wmplayer.exe', 'microsoft.media.player.exe', 'mpc-hc64.exe', 'potplayermini64.exe'],
  office: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'onenote.exe', 'acrobat.exe', 'acrord32.exe'],
});

const CATEGORY_BY_PROCESS = new Map(
  Object.entries(APP_CATEGORIES).flatMap(([category, names]) => names.map((name) => [name, category])),
);
const MAX_REMEMBERED_FOLDERS = 50;
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

// Raw helper data -> what the pet cares about, or null for "ignore this".
export function classifyForeground(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'desktop') return { category: 'desktop', app: 'desktop', maximized: false, fullscreen: false, window: raw.window };
  if (raw.kind === 'folder') return { category: 'folder', app: 'explorer', maximized: false, fullscreen: false, window: raw.window };
  // The taskbar, the pet's own windows (DevTools), or nothing: not a real switch.
  if (raw.kind !== 'app' || typeof raw.process !== 'string' || raw.process === '') return null;

  const process = raw.process.toLowerCase().slice(0, 100);
  return {
    category: CATEGORY_BY_PROCESS.get(process) ?? 'other',
    app: process.replace(/\.exe$/, ''),
    maximized: raw.maximized === true,
    fullscreen: raw.fullscreen === true,
    window: raw.window,
  };
}

export class AppAwareness {
  #helper;
  #onChange;
  #log;
  #debounceMs;
  #enabled = false;
  #current = null;
  #pending = null;
  #timer = null;
  #seenFolders = new Set();

  constructor({ helper, onChange, log = silentLog, debounceMs = 500 }) {
    this.#helper = helper;
    this.#onChange = onChange;
    this.#log = log;
    this.#debounceMs = debounceMs;
  }

  get enabled() {
    return this.#enabled;
  }

  get available() {
    return this.#helper.available;
  }

  // The app currently in front (without the internal window id), or null.
  get current() {
    if (!this.#current) return null;
    const { window, ...info } = this.#current;
    return info;
  }

  async setEnabled(enabled) {
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    if (enabled) {
      if (!this.#helper.available) {
        this.#log.info(`Noticing apps is unavailable: ${this.#helper.unavailableReason}`);
        return;
      }
      this.#log.info('Noticing which app is in front (process names only, never window titles)');
      try {
        await this.#helper.watch((event, data) => {
          if (event === 'foreground') this.#receive(data);
        });
      } catch (err) {
        this.#log.warn(`Could not watch the foreground window: ${err.message}`);
      }
    } else {
      this.#log.info('Stopped noticing apps');
      clearTimeout(this.#timer);
      this.#current = null;
      await this.#helper.unwatch();
    }
  }

  stop() {
    clearTimeout(this.#timer);
    this.#enabled = false;
  }

  #receive(raw) {
    const info = classifyForeground(raw);
    if (!info) return;
    this.#pending = info;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#emit(), this.#debounceMs);
  }

  #emit() {
    const info = this.#pending;
    this.#pending = null;
    const previous = this.#current;
    if (previous && previous.window === info.window && previous.app === info.app
      && previous.maximized === info.maximized && previous.fullscreen === info.fullscreen) return;

    // A folder window we haven't seen before = "a folder was opened".
    const newFolder = info.category === 'folder' && !this.#seenFolders.has(info.window);
    if (info.category === 'folder') this.#remember(info.window);

    this.#current = info;
    this.#log.debug(`Active app: ${info.category} (${info.app})${info.fullscreen ? ', fullscreen' : info.maximized ? ', maximized' : ''}${newFolder ? ', newly opened' : ''}`);
    const { window, ...event } = info;
    this.#onChange({ ...event, newFolder });
  }

  #remember(window) {
    this.#seenFolders.add(window);
    if (this.#seenFolders.size > MAX_REMEMBERED_FOLDERS) {
      this.#seenFolders.delete(this.#seenFolders.values().next().value);
    }
  }
}
