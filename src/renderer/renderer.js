// Renderer entry point: runs inside the pet window's page.
// It has NO Node.js access; it only talks to the app through window.desktopPet
// (defined in preload.cjs).

const api = window.desktopPet;
const pet = document.getElementById('pet');
const sprite = pet.querySelector('.pet__sprite');

function log(level, message) {
  if (api) api.log(level, message);
  else console[level](`[Pet:renderer] ${message}`);
}

if (!api) {
  // The pet still shows, but stays click-through (unclickable).
  log('error', 'Preload bridge missing: window.desktopPet is undefined');
}

// --- Click-through toggling -------------------------------------------------
// The window ignores the mouse by default, but still receives mousemove events
// (forwarded by the main process). When the cursor is over the pet we ask main
// to accept clicks; when it leaves, clicks pass through again. We only send
// IPC when the state actually changes, not on every mouse move.

let overPet = false;

function setOverPet(next) {
  if (next === overPet) return;
  overPet = next;
  api?.setClickThrough(!next);
}

document.addEventListener('mousemove', (event) => setOverPet(pet.contains(event.target)));
document.addEventListener('mouseleave', () => setOverPet(false));
window.addEventListener('blur', () => setOverPet(false));

// --- Interaction --------------------------------------------------------------

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api?.showContextMenu();
});

sprite.addEventListener('error', () => log('error', `Character image failed to load: ${sprite.src}`));

log('info', 'Renderer ready');
