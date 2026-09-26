// Everything Pip can say, grouped by topic. Code asks for a topic
// (dialogue.topic('bored')) and a line is picked at random, never the same one
// twice in a row. {name} is filled in by the caller (e.g. an icon's name);
// lines needing a value that wasn't given are skipped.
//
// Adding a dialogue: add a line to a topic below. A new topic also needs a
// place in the code that asks for it (see README "Adding a dialogue").

export const LINES = Object.freeze({
  // Direct replies to what you do
  greeting: ['Hello!', 'Hi there!', 'Hey! I live here now.'],
  click: ['Hehe!', 'That tickles!', 'Hi!', 'Nice!', ':)'],
  poked: ['Hey, stop poking!', 'Ow!', 'Rude...', 'I felt that.'],
  grab: ['Whoa!', 'Put me down!', 'Wheee!', 'Where are we going?'],
  dizzy: ['Ouch...', 'Dizzy...', 'The room is spinning...'],
  welcomeBack: ['Welcome back!', "You're back!", 'I missed you!'],
  petted: ['Purr...', 'Hehe, more!', 'I like that!', 'Mmm, nice.'],
  eat: ['Yum!', 'Crunchy!', 'Thank you!', 'Nom nom!'],
  woken: ['*yawn*... what?', 'Five more minutes...', "I'm up, I'm up!"],
  jumpForJoy: ['Wheee!', 'Yay!', 'Boing!'],

  // Answers to menu orders
  comeHere: ['Here I am!', 'Coming!', 'You called?'],
  sitOk: ['Sitting!', 'OK!', 'Like this?'],
  sleepOk: ['Nap time...', 'Goodnight...'],
  stopOk: ['OK, OK!', 'Stopping!', 'Freeze!'],
  zoomies: ['ZOOMIES!', 'Wheee!', 'Catch me!'],

  // Things that happen
  startle: ['Eek!', 'Whoa!', 'You scared me!'],
  flee: ['Eek!', "Can't catch me!", 'Nope!'],
  mouseNear: ['Where are you going?', 'Hello, cursor!', "What's that?"],
  iconSit: ['Comfy!', 'Nice spot!', 'Ooh, "{name}"!', 'I like "{name}".', 'What\'s in "{name}"?'],
  iconGone: ['Hey! Where did it go?!', 'Whoa, it vanished!'],
  iconCovered: ['Hey, I was sitting there!', 'Too crowded!'],

  // The app you switched to
  appCode: ['Back to coding?', "Let's code!", 'Ooh, code!'],
  appBrowser: ['What are we reading?', 'Surfing time!'],
  appTerminal: ['Hacker mode!', 'Ooh, commands!'],
  appChat: ['Say hi from me!', 'Who are we talking to?'],
  appMedia: ['Movie time?', 'Ooh, what are we watching?'],
  appOffice: ['Work, work...', 'Important stuff?'],
  appFolder: ["What's in there?", 'A folder!', 'Ooh, files!'],
  appDesktop: ['Desktop time!', 'Icons!', 'My playground!'],

  // Idle chatter from its own activities
  bored: ["I'm bored...", 'Hmm...', 'Nothing to do...', '*sigh*'],
  play: ['Wheee!', 'Boing!', 'Hup!'],
  dash: ['Zoom!', 'Gotta go fast!'],
  sit: ['Ahh, comfy.', 'Just resting.'],
  sleep: ['Zzz...', 'Zzz... zzz...'],
  wake: ['*yawn*', 'Good nap!', '*stretch*'],
});
