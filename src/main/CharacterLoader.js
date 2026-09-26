// Loads and validates a character pack from assets/characters/<id>/character.json.
//
// Runs in the main process because the renderer has no filesystem access.
// The renderer receives a fully normalized object: every frame has an absolute
// file:// URL and a duration, and every standard animation exists (missing ones
// are filled in from a fallback, see STANDARD_ANIMATIONS).
//
// No Electron imports here, so this module can be unit-tested with plain Node.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CHARACTERS_DIR = path.resolve(import.meta.dirname, '..', '..', 'assets', 'characters');

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const ANIMATION_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const MOTION_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const IMAGE_EXTENSIONS = new Set(['.png', '.svg', '.webp', '.gif', '.jpg', '.jpeg']);
const DEFAULT_FPS = 8;
const DEFAULT_SIZE = 96;

// The animations every character can be asked to play.
// - loop/next: defaults when the manifest does not say (next = what plays after a one-shot ends).
// - fallback: used when a character does not provide this animation.
// Order matters: each fallback points to an animation listed EARLIER, so one
// pass in order resolves chains like run -> walk -> idle.
export const STANDARD_ANIMATIONS = Object.freeze({
  idle:      { loop: true },
  blink:     { loop: false, next: 'idle', fallback: 'idle' },
  walk:      { loop: true, fallback: 'idle' },
  run:       { loop: true, fallback: 'walk' },
  sit:       { loop: true, fallback: 'idle' },
  sleep:     { loop: true, fallback: 'sit' },
  wake:      { loop: false, next: 'idle', fallback: 'blink' },
  jump:      { loop: false, next: null, fallback: 'idle' }, // holds its last frame; gravity decides when it lands
  fall:      { loop: true, fallback: 'jump' },
  happy:     { loop: false, next: 'idle', fallback: 'idle' },
  surprised: { loop: false, next: 'idle', fallback: 'idle' },
  confused:  { loop: false, next: 'idle', fallback: 'idle' },
});

// Defaults for extra, character-specific animations (e.g. "wave").
const CUSTOM_DEFAULTS = Object.freeze({ loop: false, next: 'idle' });

export class CharacterError extends Error {
  name = 'CharacterError';
}

export function loadCharacter(id, { charactersDir = DEFAULT_CHARACTERS_DIR } = {}) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new CharacterError(`Invalid character id "${id}"`);
  }
  const dir = path.join(charactersDir, id);
  const manifestPath = path.join(dir, 'character.json');

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')); // tolerate a BOM from Windows editors
  } catch (err) {
    throw new CharacterError(`Cannot read ${manifestPath}: ${err.message}`);
  }
  return normalizeManifest(raw, { id, dir });
}

// Characters that can actually be loaded, as [[id, name], ...] (for Settings).
export function listCharacters({ charactersDir = DEFAULT_CHARACTERS_DIR, fs: fileSystem = fs } = {}) {
  let entries = [];
  try {
    entries = fileSystem.readdirSync(charactersDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const characters = [];
  for (const entry of entries) {
    if (!ID_PATTERN.test(entry.name)) continue;
    try {
      const { character } = loadCharacter(entry.name, { charactersDir });
      characters.push([character.id, character.name]);
    } catch {
      // Not a usable character pack: leave it out of the list.
    }
  }
  return characters;
}

// Returns { character, warnings }. Throws CharacterError only when the
// character is unusable (bad JSON shape or no valid idle animation).
export function normalizeManifest(raw, { id, dir, fileExists = fs.existsSync }) {
  if (!isPlainObject(raw)) throw new CharacterError('Manifest must be a JSON object');
  if (!isPlainObject(raw.animations)) throw new CharacterError('Manifest needs an "animations" object');

  const warnings = [];
  const baseDir = path.resolve(dir);
  const animations = {};

  for (const [name, definition] of Object.entries(raw.animations)) {
    if (!ANIMATION_NAME_PATTERN.test(name)) {
      warnings.push(`Animation "${name}": invalid name (use lowercase letters, digits and dashes); skipped`);
      continue;
    }
    try {
      animations[name] = normalizeAnimation(name, definition, baseDir, fileExists);
    } catch (err) {
      warnings.push(`Animation "${name}": ${err.message}; skipped`);
    }
  }

  if (!animations.idle) {
    throw new CharacterError(`An "idle" animation with valid frames is required${warnings.length ? ` (${warnings.join('; ')})` : ''}`);
  }

  applyFallbacks(animations);

  for (const [name, animation] of Object.entries(animations)) {
    if (animation.next !== null && !animations[animation.next]) {
      warnings.push(`Animation "${name}": next animation "${animation.next}" does not exist; ignoring`);
      animation.next = null;
    }
  }

  const character = {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : id,
    width: sizeValue(raw.size?.width, 'width', warnings),
    height: sizeValue(raw.size?.height, 'height', warnings),
    facing: raw.facing === 'left' ? 'left' : 'right',
    animations,
  };
  return { character, warnings };
}

function normalizeAnimation(name, definition, baseDir, fileExists) {
  if (!isPlainObject(definition)) throw new Error('must be an object');
  if (!Array.isArray(definition.frames) || definition.frames.length === 0) {
    throw new Error('"frames" must be a non-empty array');
  }

  const fps = definition.fps ?? DEFAULT_FPS;
  if (typeof fps !== 'number' || !(fps > 0 && fps <= 60)) throw new Error('"fps" must be a number between 0 and 60');

  const defaults = STANDARD_ANIMATIONS[name] ?? CUSTOM_DEFAULTS;
  const defaultMs = Math.round(1000 / fps);

  return {
    frames: definition.frames.map((frame, index) => normalizeFrame(frame, index, defaultMs, baseDir, fileExists)),
    loop: typeof definition.loop === 'boolean' ? definition.loop : defaults.loop,
    next: 'next' in definition
      ? (typeof definition.next === 'string' ? definition.next : null)
      : defaults.next ?? null,
    motion: typeof definition.motion === 'string' && MOTION_PATTERN.test(definition.motion) ? definition.motion : null,
    aliasOf: null,
  };
}

function normalizeFrame(frame, index, defaultMs, baseDir, fileExists) {
  const { src, ms = defaultMs } = typeof frame === 'string' ? { src: frame } : isPlainObject(frame) ? frame : {};
  const label = `frame ${index + 1}`;

  if (typeof src !== 'string' || !src) throw new Error(`${label}: missing "src"`);
  if (!IMAGE_EXTENSIONS.has(path.extname(src).toLowerCase())) {
    throw new Error(`${label}: "${src}" is not a supported image (${[...IMAGE_EXTENSIONS].join(', ')})`);
  }
  // Frames must live inside the character's own folder: no absolute paths, no "../".
  const file = path.resolve(baseDir, src);
  if (!file.startsWith(baseDir + path.sep)) throw new Error(`${label}: "${src}" is outside the character folder`);
  if (!fileExists(file)) throw new Error(`${label}: file not found "${src}"`);
  if (typeof ms !== 'number' || !(ms >= 16 && ms <= 60000)) throw new Error(`${label}: "ms" must be between 16 and 60000`);

  return { src: pathToFileURL(file).href, ms: Math.round(ms) };
}

function applyFallbacks(animations) {
  for (const [name, spec] of Object.entries(STANDARD_ANIMATIONS)) {
    if (animations[name] || !spec.fallback) continue;
    const source = animations[spec.fallback];
    // Borrow the fallback's frames but keep this animation's own timing rules,
    // so e.g. a missing "happy" still ends and returns to idle.
    animations[name] = {
      ...source,
      loop: spec.loop,
      next: spec.next ?? null,
      aliasOf: source.aliasOf ?? spec.fallback,
    };
  }
}

function sizeValue(value, label, warnings) {
  if (value === undefined) return DEFAULT_SIZE;
  if (typeof value === 'number' && value >= 16 && value <= 512) return Math.round(value);
  warnings.push(`size.${label} must be between 16 and 512; using ${DEFAULT_SIZE}`);
  return DEFAULT_SIZE;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
