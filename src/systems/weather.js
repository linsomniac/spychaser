// systems/weather.js
//
// Weather set-pieces (spec §6 "Weather set-pieces"): FOG and ICE episodes that
// the spawn director triggers at milestones and that clear on their own after a
// fixed duration.
//
//   * FOG — purely VISUAL: reduces the draw distance and lays a vignette over
//     the play field (render/renderer.js reads fogVisibility()/intensity). It
//     does NOT affect handling.
//   * ICE — affects HANDLING: lowers the car's effective lateral grip so the
//     steering becomes slippery (momentum-carrying lateral velocity). It does
//     NOT affect visibility.
//
// AIDEV-NOTE: This module is PURE LOGIC, decoupled from Canvas / raf / Web Audio
// (spec §5). The traction math (iceTraction) and the visibility math
// (fogVisibleFraction) are free functions, unit-tested in test/weather.test.js.
// The Weather state machine advances entirely off a seconds timer — it never
// touches RNG — so a triggered episode plays out identically every run and stays
// replay-stable. The renderer reads {isFog, intensity, fogVisibility()} and the
// player reads effectiveGrip(baseGrip); neither mutates the Weather.

import { config } from "../data/config.js";

/** Fog episode kind (visibility only). */
export const WEATHER_FOG = "fog";
/** Ice episode kind (traction only). */
export const WEATHER_ICE = "ice";

/** Clamp a value into [0, 1]. */
function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Linear interpolate from a to b by t in [0, 1]. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Effective lateral grip under ice. Pure: lerps the dry `baseGrip` (intensity 0,
 * dry road) down toward `baseGrip * minGripFactor` (intensity 1, full ice).
 * Lower grip => slidier steering. `intensity` is clamped to [0, 1] so callers
 * can pass an un-clamped ramp value safely.
 *
 * @param {number} intensity     ice intensity, [0, 1]
 * @param {number} baseGrip      the dry-road grip (config.player.grip)
 * @param {number} minGripFactor fraction of baseGrip kept at full ice (<1)
 * @returns {number} effective grip
 */
export function iceTraction(intensity, baseGrip, minGripFactor) {
  const t = clamp01(intensity);
  return lerp(baseGrip, baseGrip * minGripFactor, t);
}

/**
 * Visible fraction of the play field under fog. Pure: lerps from 1 (intensity 0,
 * fully visible) down toward `floor` (intensity 1, full fog). The renderer uses
 * this to decide how far up the screen stays clear before the fog vignette takes
 * over. `intensity` is clamped to [0, 1].
 *
 * @param {number} intensity ice/fog intensity, [0, 1]
 * @param {number} floor     visible fraction at full fog (config.weather.fog.visibleFraction)
 * @returns {number} visible fraction in [floor, 1]
 */
export function fogVisibleFraction(intensity, floor) {
  const t = clamp01(intensity);
  return lerp(1, floor, t);
}

/**
 * The weather state machine. Construct once per run. `trigger(kind)` starts an
 * episode; `update(dt)` advances its intensity ramp and clears it once the
 * duration (plus fade-out) elapses. There is at most one active episode; a fresh
 * trigger replaces whatever was running.
 *
 * Intensity timeline for an episode of `duration` seconds:
 *   t in [0, fadeIn)              : ramp 0 -> 1   (fade-in)
 *   t in [fadeIn, duration)       : hold at 1     (full)
 *   t in [duration, duration+fadeOut) : ramp 1 -> 0 (fade-out)
 *   t >= duration + fadeOut       : episode clears (active = null, intensity 0)
 */
export class Weather {
  /** @param {{config?: typeof config}} [opts] */
  constructor(opts = {}) {
    /** @type {typeof config} */
    this.config = opts.config ?? config;
    /** @type {(WEATHER_FOG|WEATHER_ICE|null)} the active episode kind, or null. */
    this.active = null;
    /** @type {number} current episode intensity in [0, 1] (0 when clear). */
    this.intensity = 0;
    /** @type {number} seconds elapsed within the current episode. */
    this._elapsed = 0;
  }

  /** True while a fog episode is active. */
  get isFog() {
    return this.active === WEATHER_FOG;
  }

  /** True while an ice episode is active. */
  get isIce() {
    return this.active === WEATHER_ICE;
  }

  /** Tunables for the active episode (or null when clear). @private */
  _def() {
    if (this.active === WEATHER_FOG) return this.config.weather.fog;
    if (this.active === WEATHER_ICE) return this.config.weather.ice;
    return null;
  }

  /**
   * Start a weather episode. An unknown kind is ignored (stays clear / keeps the
   * current episode). A known kind always (re)starts from intensity 0 so the
   * fade-in plays even if one episode replaces another.
   * @param {string} kind one of WEATHER_FOG / WEATHER_ICE
   */
  trigger(kind) {
    if (kind !== WEATHER_FOG && kind !== WEATHER_ICE) return;
    this.active = kind;
    this._elapsed = 0;
    this.intensity = 0;
  }

  /** End any active episode immediately (used on reset / state changes). */
  clear() {
    this.active = null;
    this._elapsed = 0;
    this.intensity = 0;
  }

  /**
   * Advance the active episode by one step, ramping intensity and clearing the
   * episode once it has fully faded out. No-op when clear. Timer-only (no RNG).
   * @param {number} dt seconds
   */
  update(dt) {
    const def = this._def();
    if (!def) return;

    this._elapsed += dt;
    const { duration, fadeIn, fadeOut } = def;

    if (this._elapsed >= duration + fadeOut) {
      // Episode fully done — clear it.
      this.clear();
      return;
    }

    if (this._elapsed < fadeIn) {
      // Ramp in. Guard a zero fadeIn (snap to full).
      this.intensity = fadeIn > 0 ? clamp01(this._elapsed / fadeIn) : 1;
    } else if (this._elapsed < duration) {
      this.intensity = 1;
    } else {
      // Ramp out over the fade-out window. Guard a zero fadeOut.
      const into = this._elapsed - duration;
      this.intensity = fadeOut > 0 ? clamp01(1 - into / fadeOut) : 0;
    }
  }

  /**
   * The car's effective lateral grip given the dry-road `baseGrip`. Under ice it
   * is reduced toward baseGrip * minGripFactor with intensity; otherwise (clear
   * or fog) it is the dry grip unchanged (fog never affects handling).
   * @param {number} baseGrip config.player.grip
   * @returns {number}
   */
  effectiveGrip(baseGrip) {
    if (!this.isIce) return baseGrip;
    return iceTraction(this.intensity, baseGrip, this.config.weather.ice.minGripFactor);
  }

  /**
   * The visible fraction of the play field [floor, 1]. Reduced under fog with
   * intensity; 1 (fully visible) when clear or under ice (ice never fogs).
   * @returns {number}
   */
  fogVisibility() {
    if (!this.isFog) return 1;
    return fogVisibleFraction(this.intensity, this.config.weather.fog.visibleFraction);
  }
}

export default Weather;
