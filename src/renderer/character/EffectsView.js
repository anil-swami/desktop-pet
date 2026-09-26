// Little one-off particle effects: hearts when petted, crumbs when eating.
//
// Each effect adds a few small elements with a CSS animation and removes them
// when it ends, so nothing lingers. They're click-through and decorative only
// (aria-hidden), and honour reduced-motion settings (see effects.css).

export class EffectsView {
  #pet;
  #layer;
  #random;

  constructor({ pet, layer = document.body, random = Math.random }) {
    this.#pet = pet;
    this.#layer = layer;
    this.#random = random;
  }

  // Hearts rising from the pet's head (they move along with the pet).
  hearts(count = 3) {
    for (let i = 0; i < count; i += 1) {
      const heart = this.#particle('effect effect--heart', '♥');
      heart.style.setProperty('--dx', `${Math.round((this.#random() - 0.5) * 60)}px`);
      heart.style.setProperty('--delay', `${i * 140}ms`);
      this.#pet.append(heart);
    }
  }

  // Crumbs bursting out at a spot in the window (x, y).
  crumbs(x, y, count = 6) {
    for (let i = 0; i < count; i += 1) {
      const crumb = this.#particle('effect effect--crumb', '');
      const angle = (Math.PI * (i + this.#random())) / count; // spread over the upper half
      crumb.style.left = `${x}px`;
      crumb.style.top = `${y}px`;
      crumb.style.setProperty('--dx', `${Math.round(Math.cos(angle) * 34)}px`);
      crumb.style.setProperty('--dy', `${Math.round(-Math.sin(angle) * 26)}px`);
      this.#layer.append(crumb);
    }
  }

  #particle(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    element.setAttribute('aria-hidden', 'true');
    element.addEventListener('animationend', () => element.remove(), { once: true });
    return element;
  }
}
