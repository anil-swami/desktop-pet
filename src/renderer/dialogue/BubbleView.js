// The speech/thought bubble: one element, created once and reused.
//
// It lives INSIDE the pet element, so it follows the pet's GPU transform for
// free. Near a screen edge it slides sideways to stay on screen (the tail keeps
// pointing at the pet), and with no room above the pet it goes below.
//
// It's click-through (pointer-events: none): a bubble can never block a click.
// role="status" + aria-live let screen readers announce what the pet says.

const EDGE_MARGIN = 8;   // px kept free at the screen edges
const GAP_ABOVE = 22;    // px between bubble and head (room for the tail / thought dots)

export class BubbleView {
  #bubble;
  #text;
  #getPosition;
  #getPetSize;
  #visible = false;
  #width = 0;
  #height = 0;
  #shift = null;
  #below = null;

  constructor({ pet, getPosition, getPetSize }) {
    this.#getPosition = getPosition;
    this.#getPetSize = getPetSize;

    this.#bubble = document.createElement('div');
    this.#bubble.className = 'bubble';
    this.#bubble.setAttribute('role', 'status');
    this.#bubble.setAttribute('aria-live', 'polite');
    this.#bubble.setAttribute('aria-atomic', 'true');
    this.#text = document.createElement('span');
    this.#text.className = 'bubble__text';
    this.#bubble.append(this.#text);
    pet.append(this.#bubble);
  }

  show({ text, style }) {
    this.#text.textContent = text; // textContent, never HTML: names can't inject markup
    this.#bubble.dataset.style = style === 'thought' ? 'thought' : 'speech';
    // Measure once per bubble (transforms don't affect offsetWidth).
    this.#width = this.#bubble.offsetWidth;
    this.#height = this.#bubble.offsetHeight;
    this.#shift = null;
    this.#below = null;
    this.#place();
    this.#bubble.classList.add('is-visible');
    this.#visible = true;
  }

  hide() {
    this.#bubble.classList.remove('is-visible');
    this.#visible = false;
  }

  // Call when the pet moves. Cheap: only writes styles when something changes.
  reposition() {
    if (this.#visible) this.#place();
  }

  #place() {
    const { x, y } = this.#getPosition();
    const { height: petHeight } = this.#getPetSize();

    const below = y - petHeight - GAP_ABOVE - this.#height < EDGE_MARGIN;
    if (below !== this.#below) {
      this.#below = below;
      this.#bubble.classList.toggle('is-below', below);
    }

    const half = this.#width / 2;
    const centre = Math.min(Math.max(x, EDGE_MARGIN + half), window.innerWidth - EDGE_MARGIN - half);
    const shift = Math.round(centre - x);
    if (shift !== this.#shift) {
      this.#shift = shift;
      this.#bubble.style.setProperty('--bubble-shift', `${shift}px`);
    }
  }
}
