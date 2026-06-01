// core/states.js
//
// The top-level game-flow state machine (spec §5 "draw active overlay (if any)";
// plan Phase 11): ATTRACT (title/attract) -> PLAYING -> PAUSED -> GAME_OVER, with
// restart back to PLAYING. This is PURE logic: it tracks which screen is active
// and which transitions are legal, with NO dependency on canvas, requestAnimation
// Frame, Web Audio, or even the World — so it is unit-testable headlessly and the
// orchestrator (core/game.js) is the only place that wires it to input + the sim.
//
// AIDEV-NOTE: This is DELIBERATELY separate from World.state (the sim-level gate
// that latches "playing"/"gameover"). The two play different roles: World.state
// freezes the simulation math, while GameState decides which SCREEN/overlay is
// shown and gates whether the orchestrator steps the world at all. core/game.js
// keeps them in sync (e.g. world reaching "gameover" drives the machine to
// GAME_OVER; a restart resets both). Do not collapse them — many existing tests
// depend on World.state's lowercase string contract.

/**
 * The four game-flow states. Values are stable strings (used by screens.js and
 * tests); keep them in sync with render/screens.js.
 * @readonly
 * @enum {string}
 */
export const GameState = Object.freeze({
  ATTRACT: "attract", // title / attract screen; sim frozen
  PLAYING: "playing", // a run is live; sim advances
  PAUSED: "paused", // run held; sim frozen, resumable
  GAME_OVER: "gameover", // run ended; sim frozen, restartable
});

/** Set of all valid state values, for set() validation. */
const VALID = new Set(Object.values(GameState));

/**
 * @typedef {(from: string, to: string) => void} StateChangeHook
 */

export class StateMachine {
  /**
   * @param {{ initial?: string }} [opts]
   */
  constructor(opts = {}) {
    const initial = opts.initial ?? GameState.ATTRACT;
    if (!VALID.has(initial)) {
      throw new RangeError(`Invalid initial game state: ${String(initial)}`);
    }
    /** @type {string} current game-flow state */
    this._state = initial;
    /**
     * Optional hook invoked AFTER each real transition with (from, to). The
     * orchestrator attaches to this to react (reset the world on restart, swap
     * music tracks, etc.). Null by default; never fired for no-op transitions.
     * @type {StateChangeHook|null}
     */
    this.onChange = null;
  }

  /** @returns {string} the active state. */
  get state() {
    return this._state;
  }

  // --- Convenience predicates (read-only) -------------------------------------

  /** @returns {boolean} */
  get isAttract() {
    return this._state === GameState.ATTRACT;
  }
  /** @returns {boolean} */
  get isPlaying() {
    return this._state === GameState.PLAYING;
  }
  /** @returns {boolean} */
  get isPaused() {
    return this._state === GameState.PAUSED;
  }
  /** @returns {boolean} */
  get isGameOver() {
    return this._state === GameState.GAME_OVER;
  }

  /**
   * Whether the simulation should advance this tick. Only a live, un-paused run
   * is simulated; the title, pause, and game-over screens freeze the world.
   * @returns {boolean}
   */
  get shouldSimulate() {
    return this._state === GameState.PLAYING;
  }

  /**
   * Force the machine to `next`, validating + firing onChange. The transition
   * verbs below (start/togglePause/gameOver/restart/toTitle) are the intended
   * API; set() is the low-level primitive they share and is also useful for
   * tests. A no-op (next === current) does not fire onChange.
   *
   * @param {string} next a GameState value
   * @returns {boolean} true if the state actually changed
   */
  set(next) {
    if (!VALID.has(next)) {
      throw new RangeError(`Unknown game state: ${String(next)}`);
    }
    if (next === this._state) return false;
    const from = this._state;
    this._state = next;
    if (this.onChange) this.onChange(from, next);
    return true;
  }

  /**
   * Begin a run from the ATTRACT screen (Enter on the title). No-op elsewhere.
   * @returns {boolean} true if it transitioned
   */
  start() {
    if (this._state !== GameState.ATTRACT) return false;
    return this.set(GameState.PLAYING);
  }

  /**
   * Toggle pause. PLAYING <-> PAUSED only; ignored on title/game-over.
   * @returns {boolean} true if it transitioned
   */
  togglePause() {
    if (this._state === GameState.PLAYING) return this.set(GameState.PAUSED);
    if (this._state === GameState.PAUSED) return this.set(GameState.PLAYING);
    return false;
  }

  /**
   * End the run. Allowed from PLAYING or PAUSED (defensive: a run could end while
   * paused in odd edge cases). No-op from ATTRACT or when already over.
   * @returns {boolean} true if it transitioned
   */
  gameOver() {
    if (this._state === GameState.PLAYING || this._state === GameState.PAUSED) {
      return this.set(GameState.GAME_OVER);
    }
    return false;
  }

  /**
   * Start a fresh run from the GAME_OVER screen (or directly from ATTRACT, since
   * Enter on the title also begins play). Refused mid-run so a stray Enter never
   * wipes an active game. The orchestrator pairs this with world.reset().
   * @returns {boolean} true if it transitioned
   */
  restart() {
    if (this._state === GameState.GAME_OVER || this._state === GameState.ATTRACT) {
      return this.set(GameState.PLAYING);
    }
    return false;
  }

  /**
   * Return to the attract/title screen (e.g. from GAME_OVER). No-op while playing
   * so an in-progress run is never abandoned silently.
   * @returns {boolean} true if it transitioned
   */
  toTitle() {
    if (this._state === GameState.GAME_OVER) return this.set(GameState.ATTRACT);
    return false;
  }
}

export default StateMachine;
