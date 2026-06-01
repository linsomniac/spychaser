// engine/input.js
//
// Keyboard input mapping for Spy Chaser (see design spec section 9). Maps raw
// KeyboardEvent codes to logical actions and tracks which actions are currently
// held. The simulation polls the action state each tick; it never sees raw key
// events, keeping logic decoupled from the DOM.
//
// AIDEV-NOTE: Special weapon is bound to BOTH "F" and either Shift key. So
// pressing F *or* Shift triggers special. Because two physical keys map to one
// action, we ref-count holds per action (see _press/_release) — otherwise
// releasing one Shift while the other is down would wrongly clear the action.

/**
 * Logical actions the game understands.
 * @typedef {"left"|"right"|"accel"|"brake"|"fire"|"special"|"pause"|"enter"} Action
 */

/**
 * KeyboardEvent.code -> Action. Multiple codes may map to the same action.
 * @type {Record<string, Action>}
 */
export const DEFAULT_KEYMAP = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "accel",
  KeyW: "accel",
  ArrowDown: "brake",
  KeyS: "brake",
  Space: "fire",
  // Special: F OR Shift.
  KeyF: "special",
  ShiftLeft: "special",
  ShiftRight: "special",
  // Pause.
  KeyP: "pause",
  Escape: "pause",
  // Start / confirm (spec §9): used by the game-flow state machine to begin a
  // run from the title screen and to restart after game over (core/game.js reads
  // it edge-triggered via wasPressed).
  Enter: "enter",
  NumpadEnter: "enter",
});

export class Input {
  /**
   * @param {Object} [opts]
   * @param {Record<string, Action>} [opts.keymap]
   */
  constructor(opts = {}) {
    /** @type {Record<string, Action>} */
    this.keymap = opts.keymap ?? DEFAULT_KEYMAP;

    // AIDEV-NOTE: ref-count of currently-held physical keys per action so that
    // two keys bound to one action don't fight over a single boolean.
    /** @type {Map<Action, number>} */
    this._holds = new Map();
    /** @type {Set<string>} codes currently down (dedupes auto-repeat) */
    this._codesDown = new Set();
    /** edge buffer: actions that went down since last consume */
    /** @type {Set<Action>} */
    this._justPressed = new Set();

    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onKeyUp = (e) => this._handleKeyUp(e);
    this._onBlur = () => this.clear();
  }

  /** Attach DOM listeners. Returns a disposer that detaches them. */
  attach(target = typeof window !== "undefined" ? window : null) {
    if (!target) throw new Error("Input.attach() needs a DOM event target");
    target.addEventListener("keydown", this._onKeyDown);
    target.addEventListener("keyup", this._onKeyUp);
    target.addEventListener("blur", this._onBlur);
    return () => {
      target.removeEventListener("keydown", this._onKeyDown);
      target.removeEventListener("keyup", this._onKeyUp);
      target.removeEventListener("blur", this._onBlur);
    };
  }

  /**
   * @param {KeyboardEvent} e
   */
  _handleKeyDown(e) {
    const action = this.keymap[e.code];
    if (!action) return;
    // Prevent the page from scrolling on arrows/space etc. while playing.
    if (typeof e.preventDefault === "function") e.preventDefault();
    // Ignore OS auto-repeat: only the first physical press counts.
    if (this._codesDown.has(e.code)) return;
    this._codesDown.add(e.code);
    this._press(action);
  }

  /**
   * @param {KeyboardEvent} e
   */
  _handleKeyUp(e) {
    const action = this.keymap[e.code];
    if (!action) return;
    if (!this._codesDown.has(e.code)) return;
    this._codesDown.delete(e.code);
    this._release(action);
  }

  /** @param {Action} action */
  _press(action) {
    const count = (this._holds.get(action) ?? 0) + 1;
    this._holds.set(action, count);
    if (count === 1) {
      this._justPressed.add(action);
    }
  }

  /** @param {Action} action */
  _release(action) {
    const count = (this._holds.get(action) ?? 0) - 1;
    if (count <= 0) {
      this._holds.delete(action);
    } else {
      this._holds.set(action, count);
    }
  }

  /**
   * Is the action currently held?
   * @param {Action} action
   * @returns {boolean}
   */
  isDown(action) {
    return (this._holds.get(action) ?? 0) > 0;
  }

  /**
   * Was the action pressed since the last consumePressed() call? Edge-triggered,
   * useful for pause toggles and one-shot specials. Non-destructive read.
   * @param {Action} action
   * @returns {boolean}
   */
  wasPressed(action) {
    return this._justPressed.has(action);
  }

  /**
   * Read and clear the just-pressed edge buffer. Call once per tick after the
   * sim has inspected edges so each press fires exactly once.
   * @returns {Set<Action>}
   */
  consumePressed() {
    const pressed = this._justPressed;
    this._justPressed = new Set();
    return pressed;
  }

  /**
   * Snapshot of held actions, convenient for the simulation each tick.
   * @returns {Record<Action, boolean>}
   */
  snapshot() {
    return {
      left: this.isDown("left"),
      right: this.isDown("right"),
      accel: this.isDown("accel"),
      brake: this.isDown("brake"),
      fire: this.isDown("fire"),
      special: this.isDown("special"),
      pause: this.isDown("pause"),
      enter: this.isDown("enter"),
    };
  }

  /** Release everything (e.g. on window blur so keys don't "stick"). */
  clear() {
    this._holds.clear();
    this._codesDown.clear();
    this._justPressed.clear();
  }
}

export default Input;
