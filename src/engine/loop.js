// engine/loop.js
//
// Fixed-timestep game loop with an accumulator. The simulation always advances
// in fixed `dt` increments (default 1/60 s) so physics is deterministic and
// frame-rate independent. Rendering happens once per real frame and receives an
// interpolation `alpha` so visuals stay smooth between sim ticks.
//
// AIDEV-NOTE: This module is intentionally driven by an injected `now()` clock
// and an explicit `frame(nowMs)` method so it can be unit tested with no DOM /
// requestAnimationFrame. `start()`/`stop()` only exist to bridge to rAF in the
// browser; all the math lives in `frame()`.

/**
 * @typedef {Object} LoopOptions
 * @property {(dt: number) => void} update  Advance the simulation by exactly dt seconds.
 * @property {(alpha: number) => void} [render]  Draw a frame; alpha in [0,1) is interpolation.
 * @property {number} [step]    Fixed sim step in seconds (default 1/60).
 * @property {number} [maxFrameTime]  Cap on real elapsed time per frame, seconds.
 *                                    Prevents the "spiral of death" after a stall.
 * @property {() => number} [now]   Clock returning milliseconds (default performance/Date based).
 * @property {(cb: FrameRequestCallback) => number} [requestFrame]  rAF shim (browser only).
 * @property {(handle: number) => void} [cancelFrame]  cancel rAF shim.
 */

const DEFAULT_STEP = 1 / 60;
// AIDEV-NOTE: maxFrameTime caps how much sim time a single frame may try to
// catch up. Without it, one long stall (tab backgrounded, GC pause) would queue
// hundreds of update() calls and lock the page — the "spiral of death".
const DEFAULT_MAX_FRAME_TIME = 0.25; // 250ms

function defaultNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export class Loop {
  /** @param {LoopOptions} options */
  constructor(options) {
    if (!options || typeof options.update !== "function") {
      throw new TypeError("Loop requires an { update } function");
    }
    /** @type {(dt: number) => void} */
    this._update = options.update;
    /** @type {(alpha: number) => void} */
    this._render = options.render ?? (() => {});
    /** fixed sim step, seconds */
    this.step = options.step ?? DEFAULT_STEP;
    /** max real seconds consumed per frame */
    this.maxFrameTime = options.maxFrameTime ?? DEFAULT_MAX_FRAME_TIME;
    /** @type {() => number} */
    this._now = options.now ?? defaultNow;
    /** @type {((cb: FrameRequestCallback) => number) | null} */
    this._requestFrame =
      options.requestFrame ??
      (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : null);
    /** @type {((h: number) => void) | null} */
    this._cancelFrame =
      options.cancelFrame ??
      (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : null);

    if (this.step <= 0) {
      throw new RangeError("Loop step must be > 0");
    }

    /** accumulated unsimulated time, seconds */
    this._accumulator = 0;
    /** last frame timestamp in ms, or null before the first frame */
    this._lastMs = null;
    /** @type {number|null} rAF handle while running */
    this._raf = null;
    /** whether the loop is currently running via rAF */
    this._running = false;
    /** total simulation ticks executed (useful for tests/metrics) */
    this.tickCount = 0;
  }

  /** @returns {boolean} */
  get running() {
    return this._running;
  }

  /** Current leftover accumulator, seconds. */
  get accumulator() {
    return this._accumulator;
  }

  /**
   * Advance the loop given an absolute timestamp in milliseconds.
   * Pure and synchronous: safe to call from tests with hand-fed timestamps.
   *
   * @param {number} nowMs absolute time in milliseconds.
   * @returns {number} number of fixed update() steps run this frame.
   */
  frame(nowMs) {
    if (this._lastMs === null) {
      // First frame establishes a baseline; no time has "elapsed" yet.
      this._lastMs = nowMs;
      this._render(this._alpha());
      return 0;
    }

    let frameTime = (nowMs - this._lastMs) / 1000;
    this._lastMs = nowMs;

    // Guard against negative deltas (clock went backwards) and runaway stalls.
    if (frameTime < 0) frameTime = 0;
    if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;

    this._accumulator += frameTime;

    let steps = 0;
    while (this._accumulator >= this.step) {
      this._update(this.step);
      this._accumulator -= this.step;
      this.tickCount++;
      steps++;
    }

    this._render(this._alpha());
    return steps;
  }

  /** @returns {number} interpolation factor in [0, 1) for the current render. */
  _alpha() {
    return this._accumulator / this.step;
  }

  /**
   * Reset timing state. Call after a deliberate pause so the next frame does
   * not try to "catch up" the wall-clock time spent paused.
   */
  reset() {
    this._accumulator = 0;
    this._lastMs = null;
  }

  /** Begin driving the loop via requestAnimationFrame (browser only). */
  start() {
    if (this._running) return;
    if (!this._requestFrame) {
      throw new Error("Loop.start() requires requestAnimationFrame (none available)");
    }
    this._running = true;
    this.reset();
    const tick = () => {
      if (!this._running) return;
      this.frame(this._now());
      this._raf = /** @type {number} */ (this._requestFrame(tick));
    };
    this._raf = this._requestFrame(tick);
  }

  /** Stop the rAF-driven loop. */
  stop() {
    this._running = false;
    if (this._raf !== null && this._cancelFrame) {
      this._cancelFrame(this._raf);
    }
    this._raf = null;
  }
}
