// The only character module that touches the DOM.
//
//   <div class="pet" data-animation="walk" data-motion="bob">   root: size, CSS hooks
//     <div class="pet__facing is-mirrored">                     flips left/right
//       <img class="pet__sprite">                               current frame + CSS motion
//
// Flip and motion live on different elements because both use `transform`
// and would otherwise overwrite each other.

export class CharacterView {
  #root;
  #facing;
  #sprite;
  #currentSrc = null;
  #preloaded = []; // keep decoded frames referenced so they stay in memory

  constructor(root) {
    this.#root = root;
    this.#facing = root.querySelector('.pet__facing');
    this.#sprite = root.querySelector('.pet__sprite');
  }

  configure({ name, width, height }) {
    this.#root.style.setProperty('--pet-width', `${width}px`);
    this.#root.style.setProperty('--pet-height', `${height}px`);
    this.#root.setAttribute('aria-label', `Desktop pet: ${name}`);
  }

  // Decode every frame up front so swapping frames never flickers.
  // Resolves with the list of URLs that failed to load.
  async preload(urls) {
    const results = await Promise.allSettled(urls.map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    }));
    const failed = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') this.#preloaded.push(result.value);
      else failed.push(urls[i]);
    });
    return failed;
  }

  setAnimation(name, motion) {
    this.#root.dataset.animation = name;
    this.#root.dataset.motion = motion ?? 'none';
  }

  showFrame(src, mirrored) {
    if (src !== this.#currentSrc) {
      this.#sprite.src = src;
      this.#currentSrc = src;
    }
    this.#facing.classList.toggle('is-mirrored', mirrored);
  }

  // Used when no character could be loaded at all.
  showFallback() {
    this.#root.classList.add('pet--fallback');
  }
}
