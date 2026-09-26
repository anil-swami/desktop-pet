import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CharacterError, STANDARD_ANIMATIONS, loadCharacter, normalizeManifest } from '../src/main/CharacterLoader.js';

const dir = path.resolve('fake-characters', 'test');
const everyFileExists = () => true;
const normalize = (animations, fileExists = everyFileExists) =>
  normalizeManifest({ name: 'Test', animations }, { id: 'test', dir, fileExists });

describe('loadCharacter', () => {
  test('bundled default character has every standard animation with its own frames', () => {
    const { character, warnings } = loadCharacter('default');
    assert.deepEqual(warnings, []);
    assert.equal(character.name, 'Pip');
    for (const name of Object.keys(STANDARD_ANIMATIONS)) {
      assert.ok(character.animations[name], `missing ${name}`);
      assert.equal(character.animations[name].aliasOf, null, `${name} should not use a fallback`);
    }
  });

  test('rejects ids that could escape the characters folder', () => {
    assert.throws(() => loadCharacter('../secrets'), CharacterError);
    assert.throws(() => loadCharacter(''), CharacterError);
  });

  test('reports a missing character folder as a CharacterError', () => {
    assert.throws(() => loadCharacter('does-not-exist'), (err) => err instanceof CharacterError && /Cannot read/.test(err.message));
  });
});

describe('normalizeManifest', () => {
  test('turns frames into file URLs with durations from fps or ms', () => {
    const { character } = normalize({ idle: { frames: ['a.png', { src: 'b.png', ms: 300 }], fps: 4 } });
    const [a, b] = character.animations.idle.frames;
    assert.match(a.src, /^file:\/\/.*\/fake-characters\/test\/a\.png$/);
    assert.equal(a.ms, 250);
    assert.equal(b.ms, 300);
  });

  test('applies defaults for size, facing and name', () => {
    const { character } = normalizeManifest({ animations: { idle: { frames: ['a.png'] } } }, { id: 'test', dir, fileExists: everyFileExists });
    assert.equal(character.name, 'test');
    assert.equal(character.width, 96);
    assert.equal(character.facing, 'right');
  });

  test('a character with only idle still gets every standard animation', () => {
    const { character } = normalize({ idle: { frames: ['idle.png'] } });
    assert.deepEqual(Object.keys(character.animations).sort(), Object.keys(STANDARD_ANIMATIONS).sort());
    assert.equal(character.animations.run.aliasOf, 'idle');
    // Borrowed frames keep the animation's own rules: happy still ends and returns to idle.
    assert.equal(character.animations.happy.loop, false);
    assert.equal(character.animations.happy.next, 'idle');
    assert.equal(character.animations.jump.next, null);
  });

  test('fallbacks use the nearest animation the character does provide', () => {
    const { character } = normalize({ idle: { frames: ['idle.png'] }, walk: { frames: ['w1.png', 'w2.png'] }, sit: { frames: ['sit.png'] } });
    assert.equal(character.animations.run.aliasOf, 'walk');
    assert.deepEqual(character.animations.run.frames, character.animations.walk.frames);
    assert.equal(character.animations.run.loop, true);
    assert.equal(character.animations.sleep.aliasOf, 'sit');
  });

  test('every standard fallback points to an animation listed earlier', () => {
    const names = Object.keys(STANDARD_ANIMATIONS);
    for (const [index, name] of names.entries()) {
      const { fallback } = STANDARD_ANIMATIONS[name];
      if (fallback) assert.ok(names.indexOf(fallback) < index, `${name} -> ${fallback}`);
    }
  });

  test('a missing idle animation is fatal', () => {
    assert.throws(() => normalize({ walk: { frames: ['w.png'] } }), CharacterError);
    assert.throws(() => normalize({ idle: { frames: [] } }), CharacterError);
  });

  test('frames outside the character folder are rejected', () => {
    const { character, warnings } = normalize({
      idle: { frames: ['idle.png'] },
      walk: { frames: ['../other/walk.png'] },
      run: { frames: [path.resolve('elsewhere', 'run.png')] },
    });
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => /outside the character folder/.test(w)));
    assert.equal(character.animations.walk.aliasOf, 'idle');
  });

  test('missing frame files skip the animation with a warning', () => {
    const { character, warnings } = normalize(
      { idle: { frames: ['idle.png'] }, run: { frames: ['run.png'] } },
      (file) => !file.endsWith('run.png'),
    );
    assert.match(warnings[0], /run.*file not found/);
    assert.equal(character.animations.run.aliasOf, 'idle');
  });

  test('rejects unsupported file types and bad timings', () => {
    const { warnings } = normalize({
      idle: { frames: ['idle.png'] },
      walk: { frames: ['walk.exe'] },
      run: { frames: ['run.png'], fps: 0 },
      sit: { frames: [{ src: 'sit.png', ms: 1 }] },
    });
    assert.equal(warnings.length, 3);
  });

  test('a "next" pointing nowhere is dropped with a warning', () => {
    const { character, warnings } = normalize({ idle: { frames: ['idle.png'] }, wave: { frames: ['wave.png'], next: 'dance' } });
    assert.equal(character.animations.wave.next, null);
    assert.match(warnings[0], /"dance" does not exist/);
  });

  test('custom animations default to a one-shot that returns to idle', () => {
    const { character } = normalize({ idle: { frames: ['idle.png'] }, wave: { frames: ['wave.png'] } });
    assert.equal(character.animations.wave.loop, false);
    assert.equal(character.animations.wave.next, 'idle');
  });
});
