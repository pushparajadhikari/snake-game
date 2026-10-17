/**
 * Input handling: keyboard, touch swipes and the on-screen D-pad.
 *
 * Every listener registered here is tracked so dispose() can remove all of
 * them, which keeps repeated bootstraps from stacking duplicate handlers.
 */

const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
});

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const SPACE_KEYS = new Set([' ', 'Spacebar']);

/** Controls that own the arrow keys themselves (radio groups, selects). */
const ARROW_OWNERS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
/** Controls that are activated by Space or Enter. */
const SPACE_OWNERS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY']);
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date']);

/** Minimum travel, in CSS pixels, before a touch gesture counts as a swipe. */
const SWIPE_THRESHOLD = 24;

export class InputController {
  constructor({
    onDirection = () => {},
    onPause = () => {},
    onRestart = () => {},
    onMute = () => {},
    onGesture = () => {},
    keyTarget = globalThis,
    swipeTarget = null,
    padTarget = null,
  } = {}) {
    this.onDirection = onDirection;
    this.onPause = onPause;
    this.onRestart = onRestart;
    this.onMute = onMute;
    this.onGesture = onGesture;

    this.keyTarget = keyTarget;
    this.swipeTarget = swipeTarget;
    this.padTarget = padTarget;

    this.listeners = [];
    this.touchStart = null;
    this.lastPointerAt = 0;

    this.bindKeyboard();
    this.bindSwipe();
    this.bindPad();
  }

  on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    this.listeners.push({ target, type, handler, options });
  }

  bindKeyboard() {
    const handler = (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key;
      const lower = typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
      const target = event.target || null;
      const tag = target && target.tagName ? target.tagName : '';
      const type = target && typeof target.type === 'string' ? target.type.toLowerCase() : '';

      // Never interfere with typing.
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && TEXT_INPUTS.has(type))) return;
      if (target && target.isContentEditable) return;

      this.onGesture();

      const direction = KEY_DIRECTIONS[key] || KEY_DIRECTIONS[lower];
      if (direction) {
        // A focused radio group or select owns the arrow keys for navigation.
        if (ARROW_KEYS.has(key) && ARROW_OWNERS.has(tag)) return;
        // Arrow keys scroll the page otherwise, so stop that.
        if (ARROW_KEYS.has(key)) event.preventDefault();
        this.onDirection(direction, 'keyboard');
        return;
      }

      if (SPACE_KEYS.has(key)) {
        // Space activates a focused control; let the browser do its job.
        if (SPACE_OWNERS.has(tag)) return;
        event.preventDefault();
        this.onPause();
        return;
      }

      if (lower === 'p') {
        this.onPause();
        return;
      }

      if (lower === 'r') {
        this.onRestart();
        return;
      }

      if (lower === 'm') this.onMute();
    };

    this.on(this.keyTarget, 'keydown', handler);
  }

  bindSwipe() {
    if (!this.swipeTarget) return;

    const start = (event) => {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      this.touchStart = { x: touch.clientX, y: touch.clientY };
      this.onGesture();
    };

    // Non-passive so the board does not scroll or rubber-band under the finger.
    const move = (event) => {
      if (this.touchStart && event.cancelable) event.preventDefault();
    };

    const end = (event) => {
      const origin = this.touchStart;
      this.touchStart = null;
      if (!origin) return;

      const touch = (event.changedTouches && event.changedTouches[0]) || null;
      if (!touch) return;

      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        this.onDirection(dx > 0 ? 'right' : 'left', 'swipe');
      } else {
        this.onDirection(dy > 0 ? 'down' : 'up', 'swipe');
      }
    };

    const cancel = () => {
      this.touchStart = null;
    };

    this.on(this.swipeTarget, 'touchstart', start, { passive: true });
    this.on(this.swipeTarget, 'touchmove', move, { passive: false });
    this.on(this.swipeTarget, 'touchend', end, { passive: true });
    this.on(this.swipeTarget, 'touchcancel', cancel, { passive: true });
  }

  bindPad() {
    if (!this.padTarget) return;

    const directionFrom = (event) => {
      const target = event.target && event.target.closest ? event.target.closest('[data-direction]') : null;
      return target ? target.getAttribute('data-direction') : null;
    };

    // Pointer events give an immediate response; click keeps the D-pad usable
    // from the keyboard and assistive tech. The timestamp dedupes the pair.
    const pointer = (event) => {
      const direction = directionFrom(event);
      if (!direction) return;
      if (event.cancelable) event.preventDefault();
      this.lastPointerAt = Date.now();
      this.onGesture();
      this.onDirection(direction, 'pad');
    };

    const click = (event) => {
      const direction = directionFrom(event);
      if (!direction) return;
      if (Date.now() - this.lastPointerAt < 500) return;
      this.onGesture();
      this.onDirection(direction, 'pad');
    };

    this.on(this.padTarget, 'pointerdown', pointer);
    this.on(this.padTarget, 'click', click);
  }

  dispose() {
    for (const { target, type, handler, options } of this.listeners) {
      try {
        target.removeEventListener(type, handler, options);
      } catch {
        /* target already gone */
      }
    }
    this.listeners = [];
    this.touchStart = null;
  }
}

export { KEY_DIRECTIONS, SWIPE_THRESHOLD };
