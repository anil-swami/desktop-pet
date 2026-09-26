import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DialogueManager } from '../src/renderer/dialogue/DialogueManager.js';
import { LINES } from '../src/renderer/dialogue/lines.js';
import { Random } from '../src/renderer/core/Random.js';
import { fakeTicker } from './helpers.js';

function setup({ lines, seed = 5 } = {}) {
  const ticker = fakeTicker();
  const shown = [];
  const view = {
    visible: null,
    show(bubble) { this.visible = bubble; shown.push(bubble); },
    hide() { this.visible = null; },
  };
  let time = 100_000;
  const dialogue = new DialogueManager({
    view,
    ticker,
    random: new Random(seed),
    now: () => time,
    ...(lines ? { lines } : {}),
  });
  return { dialogue, view, ticker, shown, advance: (ms) => { time += ms; } };
}

describe('DialogueManager: showing and hiding', () => {
  test('show() puts a speech bubble up, and it hides itself later', () => {
    const { dialogue, view, ticker } = setup();
    assert.equal(dialogue.show("I'm bored..."), true);
    assert.deepEqual(view.visible, { text: "I'm bored...", style: 'speech' });
    assert.equal(dialogue.current, "I'm bored...");
    ticker.runTimers();
    assert.equal(view.visible, null);
    assert.equal(dialogue.current, null);
  });

  test('think() uses the thought style', () => {
    const { dialogue, view } = setup();
    dialogue.think('Zzz...');
    assert.equal(view.visible.style, 'thought');
  });

  test('longer lines stay up longer, within limits', () => {
    const { dialogue } = setup();
    assert.equal(dialogue.durationFor('Hi'), 2200);
    assert.ok(dialogue.durationFor('A line of about forty characters in all.') > 3500);
    assert.equal(dialogue.durationFor('x'.repeat(500)), 6000);
  });

  test('a custom duration is respected', () => {
    const { dialogue, ticker } = setup();
    dialogue.say('Quick!', { duration: 500 });
    assert.equal(ticker.timers.at(-1).ms, 500);
  });

  test('ignores empty text', () => {
    const { dialogue, shown } = setup();
    assert.equal(dialogue.say('   '), false);
    assert.equal(dialogue.say(null), false);
    assert.equal(shown.length, 0);
  });
});

describe('DialogueManager: not appearing constantly', () => {
  test('the same line has a cooldown', () => {
    const { dialogue, advance } = setup();
    assert.equal(dialogue.say('Nice!', { priority: 'event' }), true);
    advance(5000);
    assert.equal(dialogue.say('Nice!', { priority: 'event' }), false); // event cooldown is 15 s
    advance(11_000);
    assert.equal(dialogue.say('Nice!', { priority: 'event' }), true);
  });

  test('events need a short gap after any bubble', () => {
    const { dialogue, advance } = setup();
    dialogue.say('One', { priority: 'event' });
    advance(1000);
    assert.equal(dialogue.say('Two', { priority: 'event' }), false);
    advance(4000);
    assert.equal(dialogue.say('Two', { priority: 'event' }), true);
  });

  test('idle chatter needs a long quiet gap', () => {
    const { dialogue, ticker, advance } = setup();
    dialogue.say('Something happened', { priority: 'event' });
    ticker.runTimers(); // that bubble has faded
    advance(10_000);
    assert.equal(dialogue.say("I'm bored...", { priority: 'ambient' }), false);
    advance(20_000);
    assert.equal(dialogue.say("I'm bored...", { priority: 'ambient' }), true);
  });

  test('chatter only appears some of the time (chance)', () => {
    const { dialogue, advance } = setup({ seed: 9 });
    let appeared = 0;
    for (let i = 0; i < 200; i += 1) {
      advance(100_000);
      if (dialogue.say(`line ${i}`, { priority: 'ambient', chance: 0.25 })) appeared += 1;
    }
    assert.ok(appeared > 25 && appeared < 75, `appeared ${appeared}/200`);
  });

  test('chattiness 0 silences chatter but not replies', () => {
    const { dialogue, advance } = setup();
    dialogue.setChattiness(0);
    advance(1_000_000);
    assert.equal(dialogue.say('Hmm...', { priority: 'ambient' }), false);
    assert.equal(dialogue.say('Hi!', { priority: 'reply' }), true);
  });
});

describe('DialogueManager: priorities', () => {
  test('replies to the user show at once and replace chatter', () => {
    const { dialogue, view, advance } = setup();
    advance(100_000);
    dialogue.say('Hmm...', { priority: 'ambient' });
    assert.equal(dialogue.say('Hehe!', { priority: 'reply' }), true);
    assert.equal(view.visible.text, 'Hehe!');
  });

  test('never talks over something more important', () => {
    const { dialogue, view, advance } = setup();
    dialogue.say('Welcome back!', { priority: 'reply' });
    advance(10_000);
    assert.equal(dialogue.say('Back to coding?', { priority: 'event' }), false);
    assert.equal(view.visible.text, 'Welcome back!');
  });

  test('quiet mode (fullscreen, away) lets only replies through and hides chatter', () => {
    const { dialogue, view, advance } = setup();
    advance(100_000);
    dialogue.say('Hmm...', { priority: 'ambient' });
    dialogue.setQuiet(true);
    assert.equal(view.visible, null);
    advance(100_000);
    assert.equal(dialogue.say('Movie time?', { priority: 'event' }), false);
    assert.equal(dialogue.say('Hehe!', { priority: 'reply' }), true);
  });

  test('switching speech off hides the bubble and shows nothing', () => {
    const { dialogue, view } = setup();
    dialogue.say('Hello!', { priority: 'reply' });
    dialogue.setEnabled(false);
    assert.equal(view.visible, null);
    assert.equal(dialogue.say('Hehe!', { priority: 'reply' }), false);
  });
});

describe('DialogueManager: topics', () => {
  const lines = {
    click: ['A', 'B', 'C'],
    iconSit: ['Comfy!', 'Ooh, "{name}"!'],
    only: ['Needs {name}'],
  };

  test('picks a line from the topic, never the same twice in a row', () => {
    const { dialogue, view, advance } = setup({ lines });
    let previous = null;
    for (let i = 0; i < 30; i += 1) {
      advance(2000);
      assert.equal(dialogue.topic('click', { priority: 'reply' }), true);
      assert.ok(lines.click.includes(view.visible.text));
      assert.notEqual(view.visible.text, previous);
      previous = view.visible.text;
    }
  });

  test('the topic is the cooldown key, whatever line was picked', () => {
    const { dialogue, advance } = setup({ lines });
    assert.equal(dialogue.topic('click', { priority: 'event' }), true);
    advance(5000);
    assert.equal(dialogue.topic('click', { priority: 'event' }), false);
  });

  test('fills in {name}, shortening long names', () => {
    const { dialogue, view, advance } = setup({ lines, seed: 1 });
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
      advance(20_000);
      dialogue.topic('iconSit', { data: { name: 'A very long folder name indeed' } });
      seen.add(view.visible.text);
    }
    assert.ok(seen.has('Ooh, "A very long folder …"!'), [...seen].join(' | '));
  });

  test('skips lines whose {values} are missing', () => {
    const { dialogue, view, advance } = setup({ lines });
    for (let i = 0; i < 10; i += 1) {
      advance(20_000);
      dialogue.topic('iconSit');
      assert.equal(view.visible.text, 'Comfy!');
    }
    advance(20_000);
    assert.equal(dialogue.topic('only'), false);
  });

  test('unknown topics are ignored', () => {
    const { dialogue } = setup({ lines });
    assert.equal(dialogue.topic('nonsense'), false);
  });

  test('every topic in lines.js has at least one line', () => {
    for (const [topic, list] of Object.entries(LINES)) assert.ok(list.length > 0, topic);
  });
});
