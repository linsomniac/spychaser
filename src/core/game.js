// core/game.js
//
// The top-level orchestrator (plan Phase 11). It owns the single source of truth
// for a session — the World (sim) and the game-flow StateMachine (which screen) —
// and threads input edges into state transitions while gating whether the sim
// advances. A restart resets the world cleanly with NO state leaks between runs.
//
// AIDEV-NOTE: This module is split into a CANVAS-FREE core and a thin browser
// shell so it stays unit-testable (spec §5). The constructor takes NO canvas /
// renderer / audio; `step(dt, { held, pressed })` is pure orchestration and is
// what the tests drive. The browser wires real I/O via attachInput()/attach
// Render()/start() in main.js. Do not import canvas/AudioContext at module top
// level here — keep the sim/flow logic headless.

import { World } from "./world.js";
import { StateMachine, GameState } from "./states.js";

/**
 * @typedef {Object} GameOptions
 * @property {number} [seed]            initial world seed
 * @property {Storage|null} [storage]   high-score backend (null in tests)
 * @property {typeof import("../data/config.js").config} [config]
 * @property {() => number} [randomSeed]  source of a fresh seed on each new run;
 *   defaults to a time-derived seed in the browser. Injectable for deterministic
 *   tests (so a restart can be made reproducible).
 */

/** Held-action keys that are MENU-ONLY: never forwarded to the player sim. */
const MENU_ACTIONS = Object.freeze(["pause", "enter"]);

export class Game {
  /** @param {GameOptions} [options] */
  constructor(options = {}) {
    /** the fresh-seed source for restarts (see GameOptions.randomSeed). */
    this._randomSeed =
      options.randomSeed ?? (() => (Date.now() & 0x7fffffff) || 1);

    /** initial seed: explicit, else a fresh one. */
    this._seed = options.seed ?? this._randomSeed();

    /**
     * The simulation world. Constructed once and RESET (not recreated) on each
     * new run so pooled buffers and subsystem instances are reused — reset()
     * is responsible for clearing every per-run field (no state leaks).
     * @type {World}
     */
    this.world = new World({
      seed: this._seed,
      storage: options.storage,
      config: options.config,
    });

    /**
     * The game-flow state machine (which screen is active + legal transitions).
     * Starts on the ATTRACT/title screen.
     * @type {StateMachine}
     */
    this.machine = new StateMachine({ initial: GameState.ATTRACT });

    // --- Browser-only collaborators, wired later via attach*() (null headless).
    /** @type {import("../engine/input.js").Input|null} */
    this.input = null;
    /** @type {import("../render/renderer.js").Renderer|null} */
    this.renderer = null;
    /** @type {import("../render/screens.js").Screens|null} */
    this.screens = null;
    /** @type {import("../engine/canvas.js").GameCanvas|null} */
    this.gameCanvas = null;
    /** @type {import("../engine/loop.js").Loop|null} */
    this.loop = null;
  }

  // --- Headless orchestration -------------------------------------------------

  /**
   * Advance one frame of orchestration. PURE of any DOM (it never reads the
   * keyboard itself — the caller passes the sampled input). The flow:
   *
   *   ATTRACT   : Enter -> start a fresh run (reset world + machine.start()).
   *   PLAYING   : P/Esc -> pause; otherwise feed input + step the sim, and if the
   *               world latched game-over this tick, follow to GAME_OVER.
   *   PAUSED    : P/Esc -> resume.
   *   GAME_OVER : Enter -> restart a fresh run (reset world + machine.restart()).
   *
   * @param {number} dt seconds (the loop's fixed step)
   * @param {{ held?: object, pressed?: Set<string> }} [io]
   *   held    = per-tick held-action snapshot (engine/input.snapshot())
   *   pressed = edge set of actions pressed THIS tick (engine/input.consumePressed())
   */
  step(dt, io = {}) {
    const held = io.held ?? {};
    const pressed = io.pressed ?? EMPTY_PRESSED;

    switch (this.machine.state) {
      case GameState.ATTRACT:
        // Enter begins a run from the title screen.
        if (pressed.has("enter")) this._beginRun();
        break;

      case GameState.PLAYING:
        // Pause toggle takes priority and freezes the sim this tick.
        if (pressed.has("pause")) {
          this.machine.togglePause();
          break;
        }
        // Drive the sim from the held snapshot (menu-only keys stripped so a
        // held Enter/pause never bleeds into the player), then follow the world
        // into game-over if it ended this tick.
        this.world.setInput(this._playerInput(held));
        this.world.update(dt);
        if (this.world.state === "gameover") {
          this.machine.gameOver();
        }
        break;

      case GameState.PAUSED:
        // Resume on the next pause press; the sim stays frozen meanwhile.
        if (pressed.has("pause")) this.machine.togglePause();
        break;

      case GameState.GAME_OVER:
        // Enter starts a fresh run.
        if (pressed.has("enter")) this._restartRun();
        break;

      default:
        break;
    }
  }

  /**
   * Strip menu-only actions out of the held snapshot before it reaches the sim,
   * so the player never "drives" on Enter/pause. Returns a shallow copy.
   * @param {Record<string, boolean>} held
   * @returns {Record<string, boolean>}
   * @private
   */
  _playerInput(held) {
    const out = { ...held };
    for (const k of MENU_ACTIONS) out[k] = false;
    return out;
  }

  /**
   * Begin a brand-new run from the title screen: reset the world to a FRESH seed
   * (so each play differs while staying seed-reproducible) and flip the machine
   * to PLAYING.
   * @private
   */
  _beginRun() {
    this.world.reset(this._randomSeed());
    this.machine.start();
  }

  /**
   * Restart from the game-over screen. Same clean reset as _beginRun(), but via
   * the machine's restart() transition (GAME_OVER -> PLAYING). World.reset()
   * preserves the loaded high score, so the new run keeps the prior best.
   * @private
   */
  _restartRun() {
    this.world.reset(this._randomSeed());
    this.machine.restart();
  }

  // --- Browser wiring (no-ops/headless-safe; only used by main.js) ------------

  /**
   * Attach a keyboard Input source. Stored so the browser frame() can sample it.
   * @param {import("../engine/input.js").Input} input
   */
  attachInput(input) {
    this.input = input;
  }

  /**
   * Attach the canvas-backed render collaborators.
   * @param {import("../engine/canvas.js").GameCanvas} gameCanvas
   * @param {import("../render/renderer.js").Renderer} renderer
   * @param {import("../render/screens.js").Screens} screens
   */
  attachRender(gameCanvas, renderer, screens) {
    this.gameCanvas = gameCanvas;
    this.renderer = renderer;
    this.screens = screens;
  }

  /**
   * The browser update tick: sample the attached Input into a held snapshot + a
   * pressed edge set, run one orchestration step, then DRAIN the edge buffer so
   * each press fires exactly once. Wired into engine/loop.js by main.js.
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.input) {
      // Headless safety: with no input source, advance only when playing.
      this.step(dt, {});
      return;
    }
    const held = this.input.snapshot();
    const pressed = new Set();
    for (const a of ["enter", "pause"]) {
      if (this.input.wasPressed(a)) pressed.add(a);
    }
    this.step(dt, { held, pressed });
    // Drain the edge buffer for the next frame (one press = one fire).
    this.input.consumePressed();
  }

  /**
   * The browser render frame: draw the scene (when there is one to show) and the
   * active overlay on top. On the ATTRACT/GAME_OVER screens we still draw the
   * (frozen) world behind the overlay so the title/game-over panels sit over a
   * live-looking play field. Requires attachRender() to have run.
   * @param {number} [_alpha] interpolation factor (unused for now)
   */
  render(_alpha) {
    if (!this.renderer || !this.gameCanvas) return;
    // Always render the world first (frozen on menu screens) so overlays layer
    // over the scene; the renderer draws the HUD as part of this.
    this.renderer.render(this.world);
    // Then the active screen overlay (title / pause / game over), if any.
    if (this.screens) this.screens.draw(this.machine.state, this.world);
  }
}

/** Shared empty edge set so step() with no pressed arg allocates nothing. */
const EMPTY_PRESSED = new Set();

export default Game;
