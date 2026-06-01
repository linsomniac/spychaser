// systems/road.js
//
// Procedural road generation. The road is an endless ribbon defined entirely as
// a *pure function of scroll distance* and a per-instance seed: given the same
// seed, sampleAt(d) always returns the same shape. This is the cornerstone of
// the deterministic, headlessly-testable simulation (spec §5, §10).
//
// We deliberately avoid stateful, accumulated segment lists here. A pure
// distance->shape sampler is:
//   * order-independent (sampling 5000 then 0 == sampling 0 then 5000),
//   * trivially deterministic (no hidden mutation between calls),
//   * cheap for the renderer, which samples many rows per frame at varying d.
//
// AIDEV-NOTE: Everything below must stay a pure function of (seed, distance).
// Do NOT introduce per-call mutable state (counters, "last segment", etc.) or
// determinism + the road tests break. The only RNG use is at construction time
// to derive fixed per-instance phase/frequency offsets.

import { config } from "../data/config.js";
import { createRng } from "../engine/rng.js";

/**
 * @typedef {Object} RoadSample
 * @property {number} distance     the distance this sample was taken at (clamped >= 0)
 * @property {number} sector       integer sector index at this distance
 * @property {number} centerX      x of the road centerline, virtual px
 * @property {number} curve        signed centerline offset from screen center, virtual px
 * @property {number} width        road body width (shoulder-to-shoulder excluded), virtual px
 * @property {number} leftEdge     x where road body meets the left shoulder
 * @property {number} rightEdge    x where road body meets the right shoulder
 * @property {number} shoulderWidth grass verge width on each side, virtual px
 * @property {boolean} water       true if this stretch is a water section
 * @property {("entry"|"exit"|null)} boathouse boathouse transition band this
 *   distance falls in, or null if open water / dry land
 */

/**
 * @typedef {Object} WaterSection
 * @property {number} start  distance (px) the water stretch begins (inclusive)
 * @property {number} end    distance (px) the water stretch ends (exclusive)
 */

/**
 * Smooth, deterministic road sampler.
 */
export class Road {
  /**
   * @param {{ seed?: number, config?: typeof config }} [options]
   */
  constructor(options = {}) {
    /** @type {typeof config} */
    this.config = options.config ?? config;
    this._seed = options.seed ?? 1;

    const r = this.config.road;
    this.shoulderWidth = r.shoulderWidth;
    this.minWidth = r.minWidth;
    this.maxWidth = r.maxWidth;
    this.sectorLength = r.sectorLength;

    // Derive fixed, seed-dependent offsets once. After construction the sampler
    // is a pure function; the RNG is never touched again during sampling.
    this._initFromSeed(this._seed);
  }

  /**
   * @param {number} seed
   * @private
   */
  _initFromSeed(seed) {
    this._seed = seed;
    const rng = createRng(seed);
    const r = this.config.road;

    // Random phase + slight frequency jitter so different seeds produce visibly
    // different roads while each stays smooth and within bounds.
    this._curvePhase = rng.range(0, Math.PI * 2);
    this._curveFreq = r.curveFrequency * rng.range(0.7, 1.3);
    // A second, slower harmonic keeps the road from looking like a pure sine.
    this._curvePhase2 = rng.range(0, Math.PI * 2);
    this._curveFreq2 = r.curveFrequency * rng.range(0.3, 0.55);

    this._widthPhase = rng.range(0, Math.PI * 2);
    this._widthFreq = r.widthFrequency * rng.range(0.7, 1.3);

    // A salt mixed into the per-period water hash so the water layout is
    // seed-specific yet still a pure function of distance.
    this._waterSalt = (rng.seed() >>> 0) || 1;
  }

  /**
   * Integer sector index at a given distance. Sectors are fixed-length bands.
   * @param {number} distance virtual px traveled
   * @returns {number}
   */
  sectorAt(distance) {
    const d = distance > 0 ? distance : 0;
    return Math.floor(d / this.sectorLength);
  }

  /**
   * Deterministic water flag for a distance. Each waterPeriod-length window has
   * at most one water stretch; whether it exists is a seeded hash of the window
   * index, so the answer is a pure function of (seed, distance).
   * @param {number} distance
   * @returns {boolean}
   * @private
   */
  _waterAt(distance) {
    return this.waterSectionAt(distance) !== null;
  }

  /**
   * Bounds of the water stretch containing `distance`, or null if dry land.
   * Each waterPeriod-length window has at most one water stretch placed at its
   * tail end; whether it exists is a seeded hash of the window index, so the
   * answer is a pure function of (seed, distance) — no sampling-order state.
   *
   * AIDEV-NOTE: This is the single source of truth for water geometry. _waterAt
   * and boathouseAt both delegate here so the water flag and the boathouse
   * markers can never disagree about where the stretch begins/ends.
   * @param {number} distance
   * @returns {WaterSection|null}
   */
  waterSectionAt(distance) {
    const r = this.config.road;
    if (r.waterChance <= 0 || r.waterLength <= 0) return null;
    const d = distance > 0 ? distance : 0;
    const period = r.waterPeriod;
    const windowIndex = Math.floor(d / period);
    // AIDEV-NOTE: never put water in the first window so the run always starts
    // on solid road; the boathouse transition needs lead-in road.
    if (windowIndex <= 0) return null;

    if (hash01(windowIndex, this._waterSalt) >= r.waterChance) return null;

    // Place the water stretch at the tail end of the window so there is road
    // before and (when the window is long enough) after it.
    const windowStart = windowIndex * period;
    const start = windowStart + (period - r.waterLength);
    const end = start + r.waterLength;
    if (d < start || d >= end) return null;
    return { start, end };
  }

  /**
   * Classify whether `distance` falls inside a boathouse transition band. The
   * boathouse is the short marker the player drives through to swap between car
   * and boat: an "entry" band at the leading edge of a water stretch and an
   * "exit" band at the trailing edge. Open water between them is null, as is dry
   * land. Pure function of (seed, distance).
   *
   * AIDEV-NOTE: entry/exit are defined by position WITHIN the stretch, not by
   * travel direction — the player only ever travels forward (increasing
   * distance), so "entry" is always reached first and "exit" last. The boat
   * transition state machine (entities/boat.js) keys off these markers.
   * @param {number} distance
   * @returns {("entry"|"exit"|null)}
   */
  boathouseAt(distance) {
    const sect = this.waterSectionAt(distance);
    if (!sect) return null;
    const bh = this.config.road.boathouseLength;
    if (bh <= 0) return null;
    const d = distance > 0 ? distance : 0;
    if (d < sect.start + bh) return "entry";
    if (d >= sect.end - bh) return "exit";
    return null;
  }

  /**
   * Sample the road at a scroll distance. Pure: same (seed, distance) => same result.
   * @param {number} distance virtual px traveled (clamped to >= 0)
   * @returns {RoadSample}
   */
  sampleAt(distance) {
    const d = distance > 0 ? distance : 0;
    const r = this.config.road;

    // --- Width: oscillate smoothly between [minWidth, maxWidth]. ---
    const wNorm = 0.5 + 0.5 * Math.sin(d * this._widthFreq + this._widthPhase);
    const width = this.minWidth + (this.maxWidth - this.minWidth) * wNorm;

    // --- Curve: two-harmonic sine offset, scaled to stay within amplitude. ---
    // The two sines sum to [-2, 2]; halving keeps the magnitude in [-1, 1]
    // before scaling by curveAmplitude. (|sin a + sin b| <= 2 always.)
    const rawCurve =
      0.5 *
      (Math.sin(d * this._curveFreq + this._curvePhase) +
        Math.sin(d * this._curveFreq2 + this._curvePhase2));
    let curve = rawCurve * r.curveAmplitude;

    // --- Center: screen center + curve, clamped so road + shoulders fit. ---
    const screenCenter = this.config.VIRTUAL_WIDTH / 2;
    const halfTotal = width / 2 + this.shoulderWidth;
    const minCenter = halfTotal;
    const maxCenter = this.config.VIRTUAL_WIDTH - halfTotal;
    let centerX = screenCenter + curve;
    if (centerX < minCenter) centerX = minCenter;
    else if (centerX > maxCenter) centerX = maxCenter;
    // Keep `curve` consistent with the (possibly clamped) center so callers that
    // read .curve see the actual rendered offset.
    curve = centerX - screenCenter;

    // Water + boathouse: compute the section once and derive both flags so the
    // water flag and the boathouse marker always agree (single source of truth).
    const section = this.waterSectionAt(d);
    const water = section !== null;
    let boathouse = null;
    if (water) {
      const bh = this.config.road.boathouseLength;
      if (bh > 0) {
        if (d < section.start + bh) boathouse = "entry";
        else if (d >= section.end - bh) boathouse = "exit";
      }
    }

    return {
      distance: d,
      sector: this.sectorAt(d),
      centerX,
      curve,
      width,
      leftEdge: centerX - width / 2,
      rightEdge: centerX + width / 2,
      shoulderWidth: this.shoulderWidth,
      water,
      boathouse,
    };
  }

  /**
   * Reseed the road for a fresh deterministic layout.
   * @param {number} seed
   */
  reset(seed) {
    this._initFromSeed(seed);
  }
}

/**
 * Deterministic hash of an integer index + salt to a float in [0, 1). Used for
 * per-window water decisions so they are a pure function of position, not of
 * sampling order.
 *
 * AIDEV-NOTE: This is a one-shot mix (mulberry32-style finalizer), not the
 * streaming RNG. It must be deterministic across runs; keep the >>> 0 coercions.
 * @param {number} index
 * @param {number} salt
 * @returns {number}
 */
function hash01(index, salt) {
  let t = ((index >>> 0) + Math.imul(salt >>> 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export default Road;
