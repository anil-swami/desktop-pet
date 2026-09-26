// Draws treats: one <img> per treat, moved with a transform (x = centre,
// y = bottom). Eating shrinks it away with a little burst of crumbs.

const SIZE = 30;
const TREAT_IMAGE = '../../assets/items/treat.svg';

export class TreatView {
  #layer;
  #effects;
  #elements = new Map();

  constructor({ layer = document.body, effects }) {
    this.#layer = layer;
    this.#effects = effects;
  }

  add(treat) {
    const image = document.createElement('img');
    image.className = 'treat';
    image.src = TREAT_IMAGE;
    image.alt = '';
    image.draggable = false;
    this.#elements.set(treat.id, image);
    this.move(treat);
    this.#layer.append(image);
  }

  move(treat) {
    const image = this.#elements.get(treat.id);
    if (image) image.style.transform = `translate3d(${Math.round(treat.x - SIZE / 2)}px, ${Math.round(treat.y - SIZE)}px, 0)`;
  }

  remove(treat, { eaten }) {
    const image = this.#elements.get(treat.id);
    if (!image) return;
    this.#elements.delete(treat.id);
    if (!eaten) {
      image.remove();
      return;
    }
    this.#effects?.crumbs(treat.x, treat.y - SIZE / 2);
    image.classList.add('is-eaten');
    image.addEventListener('transitionend', () => image.remove(), { once: true });
    setTimeout(() => image.remove(), 400); // in case the transition doesn't fire (reduced motion)
  }
}
