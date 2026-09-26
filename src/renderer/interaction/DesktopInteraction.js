// Visiting desktop icons: walk over, leap on top, sit down.
//
//   scan icons ─▶ pick a free one ─▶ walk to a take-off spot beside it
//        ─▶ leap onto it (it becomes a one-way platform) ─▶ sit
//        (already on an icon? leap straight across to the next one)
//
//   carried by the mouse ─▶ every free icon becomes a landing spot
//        ─▶ let go above or on one ─▶ it sits there (same checks as a visit)
//        ─▶ keep checking: still on it? still there, same place, not covered?
//        ─▶ hop down when asked, or when the icon moves or a window covers it
//           (if the icon is deleted, the platform simply vanishes and the pet falls)
//
// Icons come from the main process (Windows helper). The pet only ever LOOKS at
// icons: nothing here can open, move or change a file.

export const DESKTOP_DEFAULTS = Object.freeze({
  takeoffOffset: 70,    // px beside the icon's centre where the leap starts
  surfaceInset: 0.15,   // share of the icon's width on each side that doesn't hold the pet
  hopDistance: 80,      // px sideways when hopping down
  maxLeap: 700,         // px: farther icons are reached via the floor instead
  checkEveryMs: 1000,   // is the pet still standing on the icon?
  rescanEveryChecks: 5, // ...and every 5th check, is the icon unchanged and uncovered?
  headroom: 4,          // px the pet needs above its head (icons near the top are skipped)
});

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

function scanProblem(scan) {
  if (!scan?.available) return `desktop icons are unavailable (${scan?.reason ?? 'no answer'})`;
  if (!scan.visible) return 'desktop icons are hidden';
  return null;
}

export class DesktopInteraction {
  #character;
  #getIcons;
  #ticker;
  #log;
  #random;
  #options;
  #onEvent;

  #token = 0;          // bumped whenever the current plan is abandoned
  #visit = null;       // { icon, token } while sitting on an icon
  #checks = 0;
  #stopChecking = null;
  #landingSpots = null; // Map id -> icon while the pet is being carried

  // onEvent(kind, icon): 'sat' | 'gone' | 'covered' — e.g. for the pet to comment.
  constructor({ character, getIcons, ticker, log = silentLog, random = Math.random, options = {}, onEvent = () => {} }) {
    this.#character = character;
    this.#getIcons = getIcons;
    this.#ticker = ticker;
    this.#log = log;
    this.#random = random;
    this.#options = { ...DESKTOP_DEFAULTS, ...options };
    this.#onEvent = onEvent;
  }

  // The icon the pet is sitting on, or null.
  get visiting() {
    return this.#visit?.icon ?? null;
  }

  // Icons the pet could visit right now: not covered by a window, and low
  // enough that the pet fits on top without its head leaving the screen.
  visitable(scan) {
    if (scanProblem(scan)) return [];
    const minTop = this.#character.size.height + this.#options.headroom;
    return scan.icons.filter((icon) => !icon.occluded && icon.y >= minTop);
  }

  // How many icons could be visited right now (not counting the one sat on).
  async freeIconCount() {
    const scan = await this.#getIcons();
    const current = this.#visit?.icon.id;
    return this.visitable(scan).filter((icon) => icon.id !== current).length;
  }

  // Visit an icon by id, or 'random' (never the one already sat on).
  // Resolves true once the pet sits on it.
  async visit(target = 'random') {
    const from = this.#visit?.icon ?? null;
    // Claim the turn, but keep watching the current icon until we actually move.
    const token = ++this.#token;
    const scan = await this.#getIcons();
    if (token !== this.#token) return false;

    const problem = scanProblem(scan);
    if (problem) {
      this.#log.info(`Can't visit an icon: ${problem}`);
      return false;
    }
    const candidates = this.visitable(scan).filter((candidate) => candidate.id !== from?.id);
    const icon = target === 'random'
      ? candidates[Math.floor(this.#random() * candidates.length)]
      : candidates.find((candidate) => candidate.id === target);
    if (!icon) {
      this.#log.info(target === 'random'
        ? 'No other icon is free to visit (covered by windows, or too close to the top)'
        : 'That icon is covered, too close to the top, already sat on, or gone');
      return false;
    }

    this.#stopWatching();
    this.#log.info(`Visiting "${icon.name}" (${icon.kind})`);
    const centreX = icon.x + icon.width / 2;
    const onFrom = from !== null && this.#character.standingOn === from.id;

    if (onFrom && Math.abs(centreX - (from.x + from.width / 2)) <= this.#options.maxLeap) {
      // Icon to icon: keep the old platform for take-off, drop it once airborne.
      this.#character.setSurfaces([this.#surfaceFor(from), this.#surfaceFor(icon)]);
      const landing = this.#character.jumpTo(centreX, icon.y);
      this.#character.setSurfaces([this.#surfaceFor(icon)]);
      await landing;
    } else {
      // Via the floor: drop down if needed, walk to a take-off spot, leap.
      if (this.#character.standingOn !== null || !this.#character.grounded) {
        this.#character.setSurfaces([]);
        await this.#character.whenLanded();
        if (token !== this.#token) return false;
      }
      const side = this.#character.position.x <= centreX ? -1 : 1;
      if (!(await this.#character.moveTo(centreX + side * this.#options.takeoffOffset, { label: 'take-off spot' }))) return false;
      if (token !== this.#token) return false;
      this.#character.setSurfaces([this.#surfaceFor(icon)]);
      await this.#character.jumpTo(centreX, icon.y);
    }
    if (token !== this.#token) return false;
    if (this.#character.standingOn !== icon.id) {
      this.#log.info(`Missed "${icon.name}"`);
      this.#character.setSurfaces([]);
      return false;
    }

    this.#visit = { icon, token };
    this.#checks = 0;
    this.#character.play('sit');
    this.#log.info(`Sitting on "${icon.name}"`);
    this.#onEvent('sat', icon);
    this.#scheduleCheck(token);
    return true;
  }

  // Hop down to the floor. Resolves true on landing.
  leave() {
    const visit = this.#visit;
    this.#abandon();
    if (!visit || this.#character.standingOn !== visit.icon.id) {
      this.#character.setSurfaces([]);
      return Promise.resolve(false);
    }
    const centreX = visit.icon.x + visit.icon.width / 2;
    const { min, max } = this.#character.walkableRange;
    const hop = this.#options.hopDistance;
    let side = this.#random() < 0.5 ? -1 : 1;
    if (centreX + side * hop < min || centreX + side * hop > max) side = -side;

    this.#log.info(`Hopping down from "${visit.icon.name}"`);
    const landing = this.#character.jumpTo(centreX + side * hop, this.#character.floorY);
    this.#character.setSurfaces([]); // already airborne, so this can't make it fall
    return landing;
  }

  // The pet was picked up: make every free icon a place it can be put down.
  async offerLandingSpots() {
    const token = this.#abandon(); // it's being carried: whatever visit there was is over
    this.#landingSpots = null;
    const scan = await this.#getIcons();
    if (token !== this.#token || !this.#character.held) return; // already let go
    const icons = this.visitable(scan);
    this.#landingSpots = new Map(icons.map((icon) => [icon.id, icon]));
    this.#character.setSurfaces(icons.map((icon) => this.#surfaceFor(icon)));
    this.#log.debug(`${icons.length} icon(s) ready to be landed on`);
  }

  // The pet was let go and has landed. On an icon? Then it sits there.
  settleAfterDrop() {
    const icon = this.#landingSpots?.get(this.#character.standingOn) ?? null;
    this.#landingSpots = null;
    if (!icon) {
      if (this.#character.standingOn === null) this.#character.setSurfaces([]);
      return false;
    }
    this.#character.setSurfaces([this.#surfaceFor(icon)]);
    const token = ++this.#token;
    this.#visit = { icon, token };
    this.#checks = 0;
    this.#character.play('sit');
    this.#log.info(`Put down on "${icon.name}": sitting there`);
    this.#onEvent('sat', icon);
    this.#scheduleCheck(token);
    return true;
  }

  // Forget any plan and remove the platform (a pet standing on it falls).
  cancel() {
    this.#abandon();
    this.#character.setSurfaces([]);
  }

  dispose() {
    this.#abandon();
  }

  #abandon() {
    this.#token += 1;
    this.#stopWatching();
    return this.#token;
  }

  // Forget the current visit (stop checking on it) without touching the platform.
  #stopWatching() {
    this.#visit = null;
    this.#stopChecking?.();
    this.#stopChecking = null;
  }

  // Only the middle of the icon holds the pet, so it visibly sits on the picture.
  // `depth`: letting go with the feet anywhere on the icon still counts.
  #surfaceFor(icon) {
    const inset = icon.width * this.#options.surfaceInset;
    return { id: icon.id, left: icon.x + inset, right: icon.x + icon.width - inset, top: icon.y, depth: icon.height };
  }

  #scheduleCheck(token) {
    this.#stopChecking = this.#ticker.after(this.#options.checkEveryMs, () => {
      this.#stopChecking = null;
      this.#check(token);
    });
  }

  async #check(token) {
    const visit = this.#visit;
    if (!visit || visit.token !== token) return;

    // Walked off, dragged away, followed the mouse...: the visit is over.
    if (this.#character.standingOn !== visit.icon.id) {
      this.#log.debug(`No longer on "${visit.icon.name}"`);
      this.cancel();
      return;
    }

    this.#checks += 1;
    if (this.#checks % this.#options.rescanEveryChecks === 0) {
      const scan = await this.#getIcons();
      if (this.#visit?.token !== token) return;
      const problem = this.#problemWith(visit.icon, scan);
      if (problem === 'gone') {
        this.#log.info(`"${visit.icon.name}" disappeared!`);
        this.cancel(); // no platform any more: the pet falls
        this.#onEvent('gone', visit.icon);
        return;
      }
      if (problem) {
        this.#log.info(`Leaving "${visit.icon.name}": ${problem}`);
        this.leave();
        if (problem === 'a window covered it') this.#onEvent('covered', visit.icon);
        return;
      }
    }
    this.#scheduleCheck(token);
  }

  #problemWith(icon, scan) {
    if (!scan?.available) return null; // a helper hiccup is not a reason to jump
    if (!scan.visible) return 'desktop icons were hidden';
    const current = scan.icons.find((candidate) => candidate.id === icon.id);
    if (!current) return 'gone';
    if (Math.abs(current.x - icon.x) > 2 || Math.abs(current.y - icon.y) > 2) return 'it was moved';
    if (current.occluded) return 'a window covered it';
    return null;
  }
}
