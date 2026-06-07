// systems/scoring.js
//
// Scoring, lives & the classic bonus-time mechanic (spec §6 "Scoring & lives"):
//
//   * Score events: enemy kills (point value), distance traveled (per px), and
//     the implicit "no-civilian-harm" bonus — keeping the bonus window alive is
//     itself the reward for not shooting civilians.
//   * Bonus-time window: a run OPENS with a free-replacement window (`bonusWindow`
//     seconds) during which a wreck is replaced for FREE (no spare car spent).
//   * Score-threshold banking: crossing `bonusThreshold` points BEFORE the window
//     closes BANKS `bonusSpareCars` spare cars — once per run.
//   * Civilian penalty + bonus suspension: harming a civilian subtracts points
//     AND suspends the bonus, revoking free replacements and blocking banking.
//   * Lives state machine: after the window (or once suspended), each wreck costs
//     a spare car; the game ends (`gameOver`) when the count reaches zero.
//   * High score persists in localStorage.
//
// AIDEV-NOTE: This module is PURE LOGIC, decoupled from Canvas / raf / Web Audio
// (spec §5). It takes the storage backend by INJECTION (constructor `storage`)
// and otherwise falls back to a globalThis.localStorage probe, guarded so it is a
// no-op (never throws) in Node tests where no localStorage exists. The world owns
// one Scoring instance and routes its score/lives state through it; the
// score/lives logic is unit-tested headlessly in test/scoring.test.js.

import { config } from "../data/config.js";

/**
 * Best-effort resolution of a Web Storage backend.
 *   * an explicitly injected `storage` (including `null` to force "no storage")
 *   * otherwise globalThis.localStorage if present (browser)
 *   * otherwise null (Node tests) -> persistence becomes a no-op
 *
 * AIDEV-NOTE: accessing localStorage can THROW (Safari private mode, disabled
 * cookies) so the global probe is wrapped in try/catch. Never let persistence
 * crash the sim.
 * @param {Storage|null|undefined} injected
 * @returns {Storage|null}
 */
function resolveStorage(injected) {
  if (injected !== undefined) return injected; // honor explicit null
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage access denied (private mode / sandbox) -> no persistence.
  }
  return null;
}

export class Scoring {
  /**
   * @param {{ config?: typeof config, storage?: Storage|null }} [opts]
   */
  constructor(opts = {}) {
    /** @type {typeof config} */
    this.config = opts.config ?? config;
    /** @type {Storage|null} persistence backend (may be null in tests). */
    this.storage = resolveStorage(opts.storage);

    this._init();
    /** Best score seen, in memory; loadHighScore() seeds it from storage. */
    this.hiScore = 0;
  }

  /** localStorage key for the persisted high score. */
  static HISCORE_KEY = "spychaser.hiscore";

  /** Initialize the per-run state (everything reset() restores). @private */
  _init() {
    const sc = this.config.scoring;
    /** Running score for the current run. */
    this.score = 0;
    /** Civilians destroyed this run (penalty marker / HUD). */
    this.civilianHits = 0;
    /** Spare cars in reserve; the game ends when this hits zero. */
    this.cars = sc.startCars;
    /** True once the last car is wrecked. */
    this.gameOver = false;

    /** Seconds left in the free-replacement window (0 once closed). */
    this.bonusRemaining = sc.bonusWindow;
    /** True once a civilian is harmed: revokes free replacements + banking. */
    this.bonusSuspended = false;
    /** True once the threshold has banked spare cars (one-shot per run). */
    this.banked = false;
    /** Whether the LAST saveHighScore() set a genuine new record (strict >). */
    this.newRecord = false;

    /**
     * Sub-point distance accumulator. Distance points come in tiny fractional
     * dribbles per tick (baseScrollSpeed * dt * distanceScorePerPx); we hold the
     * fraction here and only fold WHOLE points into `score` so the arcade score
     * stays integer-valued (and single-tick kill/penalty deltas stay exact).
     * @type {number}
     */
    this._distanceFraction = 0;
  }

  /**
   * Whether the bonus-time window is currently GRANTING free wreck replacements.
   * Folds in the timer AND the civilian-harm suspension: a suspended window
   * grants nothing even with time left on the clock.
   * @returns {boolean}
   */
  get bonusActive() {
    return this.bonusRemaining > 0 && !this.bonusSuspended;
  }

  /**
   * Advance the bonus-time window by one step. Pure timer (no RNG); the window
   * only ever counts down and clamps at zero. No-op once the game is over.
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.gameOver) return;
    if (this.bonusRemaining > 0) {
      this.bonusRemaining = Math.max(0, this.bonusRemaining - dt);
    }
  }

  /**
   * Award points for destroying an enemy and re-check the banking threshold.
   * @param {number} value point value (config.enemies.*.scoreValue)
   */
  addKill(value) {
    if (!(value > 0)) return;
    this.score += value;
    this._checkBanking();
  }

  /**
   * Accrue distance-traveled points. Only positive deltas score (no rewind
   * points). Distance points dribble in fractionally per tick, so we accumulate
   * the fraction and fold only WHOLE points into `score` (keeping the arcade
   * score integer-valued); re-checks the banking threshold afterward.
   *
   * AIDEV-NOTE: the integer fold is what keeps single-tick kill/penalty score
   * deltas exact (a sub-point of distance in the same tick does not perturb the
   * integer score), while distance still accrues correctly over time.
   * @param {number} px virtual px traveled since the last call
   */
  addDistance(px) {
    if (!(px > 0)) return;
    this._distanceFraction += px * this.config.scoring.distanceScorePerPx;
    const whole = Math.floor(this._distanceFraction);
    if (whole > 0) {
      this.score += whole;
      this._distanceFraction -= whole;
      this._checkBanking();
    }
  }

  /**
   * Apply the civilian-harm consequence: subtract the penalty (score floored at
   * zero), count the hit, and SUSPEND the bonus (revoking free replacements and
   * blocking any future banking) — mirrors the original's protect-the-innocent
   * rule. Idempotent on suspension (further hits just re-penalize).
   * @param {number} [penalty] points lost (defaults to config.civilians.scorePenalty)
   */
  civilianPenalty(penalty = this.config.civilians.scorePenalty) {
    this.score = Math.max(0, this.score - penalty);
    this.civilianHits += 1;
    this.bonusSuspended = true;
  }

  /**
   * Register a wreck. During the active (un-suspended) bonus window the car is
   * replaced for FREE — returns false, cars unchanged. Otherwise it costs a spare
   * car; the game ends if that empties the reserve. Returns whether a car was
   * actually spent.
   *
   * AIDEV-NOTE: the return value lets the caller distinguish a free respawn from
   * a paid one (e.g. for SFX / HUD flashes). bonusActive already folds in both
   * the timer and the civilian-harm suspension.
   * @returns {boolean} true if a spare car was consumed
   */
  loseCar() {
    if (this.gameOver) return false;
    if (this.bonusActive) return false; // free replacement
    this.cars = Math.max(0, this.cars - 1);
    if (this.cars <= 0) {
      this.cars = 0;
      this.gameOver = true;
    }
    return true;
  }

  /**
   * Bank spare cars if the score has crossed the threshold while the bonus window
   * is still granting (timer left AND not suspended). One-shot per run via the
   * `banked` flag. Called after every scoring event.
   * @private
   */
  _checkBanking() {
    if (this.banked) return;
    if (!this.bonusActive) return;
    const sc = this.config.scoring;
    if (this.score >= sc.bonusThreshold) {
      this.cars += sc.bonusSpareCars;
      this.banked = true;
    }
  }

  /**
   * Load the persisted high score from storage into `hiScore`. No-op (leaves
   * hiScore at its current value) when there is no backing store. Guarded so a
   * throwing/garbage store never crashes the sim.
   */
  loadHighScore() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(Scoring.HISCORE_KEY);
      const n = raw == null ? 0 : Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > this.hiScore) this.hiScore = n;
    } catch {
      // Read failed -> keep whatever hiScore we have.
    }
  }

  /**
   * Persist the current score as the high score IF it beats the existing record.
   * Always keeps `hiScore` tracking the in-memory best (even with no store), so
   * the HUD shows the right value mid-run. Returns whether a NEW record was set.
   * @returns {boolean}
   */
  saveHighScore() {
    const isRecord = this.score > this.hiScore;
    // AIDEV-NOTE: latch the record decision (strict >) so the game-over panel can
    // tell a genuine NEW RECORD from a tie with the existing high score. Once
    // hiScore has been bumped to score, a tie and a record are indistinguishable
    // from score/hiScore alone — hence the explicit flag (L1).
    this.newRecord = isRecord;
    if (isRecord) this.hiScore = this.score;
    if (!this.storage) return isRecord;
    try {
      if (isRecord) this.storage.setItem(Scoring.HISCORE_KEY, String(this.hiScore));
    } catch {
      // Write failed (quota / private mode) -> in-memory hiScore still updated.
    }
    return isRecord;
  }

  /**
   * Reset for a fresh run. KEEPS the loaded high score (it persists across runs);
   * everything else returns to the start-of-run state.
   */
  reset() {
    this._init();
  }
}

export default Scoring;
