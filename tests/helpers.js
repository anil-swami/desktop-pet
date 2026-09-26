// Test doubles for the renderer's Ticker and CharacterView.

export function fakeTicker() {
  const listeners = new Set();
  const timers = [];
  return {
    listeners,
    timers,
    add(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    after(ms, callback) {
      const timer = { ms, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    tick(dt) {
      for (const listener of [...listeners]) listener(dt);
    },
  };
}

export function fakeView() {
  return {
    frames: [],
    animations: [],
    setAnimation(name, motion) { this.animations.push({ name, motion }); },
    showFrame(src, mirrored) { this.frames.push({ src, mirrored }); },
    get last() { return this.frames.at(-1); },
  };
}

export const frame = (src, ms = 100) => ({ src, ms });

export const TEST_ANIMATIONS = {
  idle: { frames: [frame('idle')], loop: true, next: null, motion: 'breathe', aliasOf: null },
  blink: { frames: [frame('blink', 140)], loop: false, next: 'idle', motion: 'breathe', aliasOf: null },
  walk: { frames: [frame('w1'), frame('w2'), frame('w3')], loop: true, next: null, motion: 'bob', aliasOf: null },
  happy: { frames: [frame('h1'), frame('h2')], loop: false, next: 'idle', motion: null, aliasOf: null },
  jump: { frames: [frame('j1'), frame('j2')], loop: false, next: null, motion: null, aliasOf: null },
};
