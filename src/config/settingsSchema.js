// Every user setting in one place: type, default, limits, and how it's shown.
//
// The main process uses this to validate what's saved (and to repair a
// hand-edited or corrupted file); the settings window builds its controls
// from it. Adding a setting = adding an entry here, then applying it where it
// matters (see README "Settings").
//
// Pure module (no Electron, no files), so it's tested directly.

export const SECTIONS = Object.freeze(['Behavior', 'Appearance', 'Desktop', 'Performance']);

export const SETTINGS = Object.freeze([
  { key: 'autonomous', section: 'Behavior', label: 'Live on its own', type: 'boolean', default: true,
    hint: 'Walk, play, nap and visit icons without being asked.' },
  { key: 'activityLevel', section: 'Behavior', label: 'Activity', type: 'choice', default: 'normal',
    options: [['calm', 'Calm'], ['normal', 'Normal'], ['lively', 'Lively']],
    hint: 'How quickly it moves on to something new.' },
  { key: 'walkSpeed', section: 'Behavior', label: 'Walking speed', type: 'number', default: 60,
    min: 30, max: 120, step: 5, unit: 'px/s' },
  { key: 'runSpeed', section: 'Behavior', label: 'Running speed', type: 'number', default: 190,
    min: 100, max: 320, step: 10, unit: 'px/s' },
  { key: 'mouseReactions', section: 'Behavior', label: 'React to the mouse', type: 'boolean', default: true,
    hint: 'Look at the cursor, get startled by fast moves.' },
  { key: 'speech', section: 'Behavior', label: 'Speech bubbles', type: 'boolean', default: true },
  { key: 'chattiness', section: 'Behavior', label: 'Chattiness', type: 'choice', default: 'normal',
    options: [['quiet', 'Quiet'], ['normal', 'Normal'], ['chatty', 'Chatty']],
    hint: 'How often it chats when nothing special is happening.' },
  { key: 'noticeApps', section: 'Behavior', label: 'Notice which app I use', type: 'boolean', default: true,
    hint: "Only the app's name (like Code.exe), never window titles." },

  { key: 'character', section: 'Appearance', label: 'Character', type: 'choice', default: 'default',
    options: 'characters' }, // filled in from assets/characters
  { key: 'scale', section: 'Appearance', label: 'Size', type: 'number', default: 1,
    min: 0.6, max: 1.6, step: 0.1, unit: '×' },
  { key: 'animationSpeed', section: 'Appearance', label: 'Animation speed', type: 'number', default: 1,
    min: 0.5, max: 2, step: 0.1, unit: '×' },

  { key: 'alwaysOnTop', section: 'Desktop', label: 'Always on top', type: 'boolean', default: true,
    hint: 'Off: windows you open can cover the pet.' },
  { key: 'ghostMode', section: 'Desktop', label: 'Let clicks pass through the pet', type: 'boolean', default: false,
    hint: 'Hold Ctrl to click or drag it again.' },

  { key: 'reducedMotion', section: 'Performance', label: 'Reduce motion', type: 'choice', default: 'system',
    options: [['system', 'Like Windows'], ['on', 'On'], ['off', 'Off']],
    hint: 'Fewer bouncy effects and particles.' },
  { key: 'quality', section: 'Performance', label: 'Animation quality', type: 'choice', default: 'smooth',
    options: [['smooth', 'Smooth'], ['saver', 'Battery saver']],
    hint: 'Battery saver moves at 30 frames per second.' },
  { key: 'restWhenAway', section: 'Performance', label: "Rest when I'm away", type: 'boolean', default: true,
    hint: 'Nap and pause effects after 5 minutes without input.' },
]);

const BY_KEY = new Map(SETTINGS.map((definition) => [definition.key, definition]));

export function defaultSettings() {
  return Object.fromEntries(SETTINGS.map(({ key, default: value }) => [key, value]));
}

function optionsFor(definition, characters) {
  return definition.options === 'characters' ? characters : definition.options;
}

// Snap to the step and trim float noise (0.1 + 0.2 → 0.3, not 0.30000000000000004).
function snap(value, { min, max, step }) {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(snapped.toFixed(decimals));
}

// Check one value. Returns { ok: true, value } (numbers are clamped and snapped)
// or { ok: false, error }.
export function validateSetting(key, value, { characters = [['default', 'Pip']] } = {}) {
  const definition = BY_KEY.get(key);
  if (!definition) return { ok: false, error: `Unknown setting "${key}"` };

  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: `${key} must be true or false` };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value: snap(value, definition) }
        : { ok: false, error: `${key} must be a number` };
    case 'choice': {
      const allowed = optionsFor(definition, characters).map(([id]) => id);
      return allowed.includes(value) ? { ok: true, value } : { ok: false, error: `${key} must be one of: ${allowed.join(', ')}` };
    }
    default:
      return { ok: false, error: `Unsupported type for ${key}` };
  }
}

// Validate a whole saved object. Unknown keys are dropped; invalid values fall
// back to their default. Returns { values, problems }.
export function validateSettings(raw, { characters } = {}) {
  const values = defaultSettings();
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined) problems.push('Settings were not an object; using defaults');
    return { values, problems };
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!BY_KEY.has(key)) continue; // e.g. a setting from an older version
    const result = validateSetting(key, value, { characters });
    if (result.ok) values[key] = result.value;
    else problems.push(`${result.error}; using the default`);
  }
  return { values, problems };
}

// The schema with dynamic options filled in, ready to send to the settings window.
export function describeSettings({ characters = [['default', 'Pip']] } = {}) {
  return SETTINGS.map((definition) => ({ ...definition, options: definition.options ? optionsFor(definition, characters) : undefined }));
}
