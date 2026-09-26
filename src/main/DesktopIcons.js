// Desktop icons as the pet sees them: name, kind and rectangle in the pet
// window's coordinates (DIPs relative to the work area), plus whether a window
// currently covers the icon.
//
// The Windows helper reports physical screen pixels; here they are converted to
// DIPs (see DisplayManager for why) and to window coordinates. The renderer
// never gets file paths: icons are identified by the helper's anonymous ids.

const KINDS = new Set(['folder', 'file', 'shortcut', 'system']);
const ID_PATTERN = /^[0-9a-f]{12}$/;
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export const unavailableScan = (reason) => ({ available: false, reason, visible: false, icons: [] });

// Validate and convert raw helper output. Anything malformed is dropped.
export function normalizeDesktopScan(raw, { toDipRect, workArea }) {
  if (!raw || typeof raw !== 'object') throw new Error('Unexpected desktop scan from the helper');
  if (!raw.Visible) return { available: true, visible: false, icons: [] };

  const icons = [];
  for (const item of Array.isArray(raw.Icons) ? raw.Icons : []) {
    if (!item || !ID_PATTERN.test(item.Id) || typeof item.Name !== 'string' || !KINDS.has(item.Kind)) continue;
    const physical = { x: item.X, y: item.Y, width: item.Width, height: item.Height };
    if (!Object.values(physical).every(Number.isFinite) || physical.width <= 0 || physical.height <= 0) continue;

    const dip = toDipRect(physical);
    const icon = {
      id: item.Id,
      name: item.Name.replace(/[\u0000-\u001f]/g, '').slice(0, 80),
      kind: item.Kind,
      x: Math.round(dip.x - workArea.x),
      y: Math.round(dip.y - workArea.y),
      width: Math.round(dip.width),
      height: Math.round(dip.height),
      occluded: item.Occluded === true,
    };
    // Only icons fully inside the work area (not under the taskbar, not off-screen).
    if (icon.x < 0 || icon.y < 0 || icon.x + icon.width > workArea.width || icon.y + icon.height > workArea.height) continue;
    icons.push(icon);
  }
  return { available: true, visible: true, icons };
}

export class DesktopIcons {
  #helper;
  #toDipRect;
  #getWorkArea;
  #log;
  #last = null;
  #inFlight = null;

  constructor({ helper, toDipRect, getWorkArea, log = silentLog }) {
    this.#helper = helper;
    this.#toDipRect = toDipRect;
    this.#getWorkArea = getWorkArea;
    this.#log = log;
  }

  // Most recent scan (or null), with a `time` stamp.
  get last() {
    return this.#last;
  }

  // Fresh scan. Calls made while one is running share its result.
  scan() {
    this.#inFlight ??= this.#scan().finally(() => { this.#inFlight = null; });
    return this.#inFlight;
  }

  async #scan() {
    let result;
    if (!this.#helper.available) {
      result = unavailableScan(this.#helper.unavailableReason);
    } else {
      try {
        const raw = await this.#helper.request('desktop-icons');
        result = normalizeDesktopScan(raw, { toDipRect: this.#toDipRect, workArea: this.#getWorkArea() });
        const free = result.icons.filter((icon) => !icon.occluded).length;
        this.#log.debug(result.visible
          ? `Desktop scan: ${result.icons.length} icons, ${free} not covered by windows`
          : 'Desktop scan: desktop icons are hidden');
      } catch (err) {
        this.#log.warn(`Desktop scan failed: ${err.message}`);
        result = unavailableScan(err.message);
      }
    }
    this.#last = { ...result, time: Date.now() };
    return this.#last;
  }
}
