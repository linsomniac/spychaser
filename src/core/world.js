// core/world.js
//
// The simulation world: the single source of truth for game state. It is kept
// completely decoupled from Canvas and requestAnimationFrame so it can be unit
// tested headlessly. The loop calls `world.update(dt)` with a fixed step; the
// renderer reads from the world but never mutates it.
//
// AIDEV-NOTE: Grown from the Phase 0 stub. Holds the deterministic sim state
// (seeded RNG, tick/time counters, scroll distance) plus the procedural Road.
// Later phases (player, enemies, weapons, director, scoring) flesh it out.

import { createRng } from "../engine/rng.js";
import { config } from "../data/config.js";
import { Road } from "../systems/road.js";

/**
 * @typedef {Object} WorldOptions
 * @property {number} [seed]   RNG seed for deterministic runs.
 * @property {typeof config} [config]  Tunables (defaults to data/config.js).
 */

export class World {
  /** @param {WorldOptions} [options] */
  constructor(options = {}) {
    /** @type {typeof config} */
    this.config = options.config ?? config;
    /** seed retained so we can rebuild deterministic subsystems on reset */
    this._seed = options.seed ?? 1;
    /** @type {import("../engine/rng.js").Rng} */
    this.rng = createRng(this._seed);

    /** virtual play-field dimensions, mirrored for convenience */
    this.width = this.config.VIRTUAL_WIDTH;
    this.height = this.config.VIRTUAL_HEIGHT;

    /** seconds of simulated time elapsed */
    this.time = 0;
    /** number of fixed update ticks executed */
    this.ticks = 0;
    /** total virtual px the world has scrolled (proxy for distance) */
    this.distance = 0;
    /**
     * Current scroll speed in virtual px/s. Defaults to the road base speed;
     * the player's throttle adjusts this in a later phase. `distance` advances
     * by `speed * dt` each tick.
     */
    this.speed = this.config.road.baseScrollSpeed;

    /**
     * Procedural road. The Road instance gets its own seed derived from the
     * world seed so road layout is reproducible without entangling its RNG
     * stream with the world's (which the director/spawns will consume).
     * @type {Road}
     */
    this.road = new Road({ seed: this._roadSeed(this._seed), config: this.config });

    /** simple lifecycle flag; later phases add menu/playing/gameover */
    this.state = "playing";
  }

  /**
   * Derive a stable, distinct road seed from the world seed so the road's RNG
   * stream is independent of (but reproducible from) the world seed.
   * @param {number} seed
   * @returns {number}
   * @private
   */
  _roadSeed(seed) {
    // AIDEV-NOTE: XOR with a fixed constant keeps it deterministic while
    // decoupling the road's derived offsets from the world RNG stream.
    return (((seed >>> 0) ^ 0x5193b1c7) >>> 0) || 1;
  }

  /**
   * Advance the simulation by exactly `dt` seconds (the loop's fixed step).
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.state !== "playing") return;
    this.time += dt;
    this.ticks += 1;
    // Scroll advances by the current speed (defaults to base scroll speed).
    this.distance += this.speed * dt;
  }

  /**
   * Sample the road at the current scroll distance (or an explicit distance).
   * Pure pass-through to the Road sampler; the renderer and collision use this.
   * @param {number} [distance] defaults to the world's current scroll distance
   * @returns {import("../systems/road.js").RoadSample}
   */
  sampleRoad(distance = this.distance) {
    return this.road.sampleAt(distance);
  }

  /** Current integer sector index at the world's scroll distance. */
  get sector() {
    return this.road.sectorAt(this.distance);
  }

  /**
   * Reset to an initial state. Optionally reseed for a fresh deterministic run.
   * @param {number} [seed]
   */
  reset(seed) {
    if (seed !== undefined) {
      this._seed = seed;
      this.rng = createRng(seed);
      this.road.reset(this._roadSeed(seed));
    }
    this.time = 0;
    this.ticks = 0;
    this.distance = 0;
    this.speed = this.config.road.baseScrollSpeed;
    this.state = "playing";
  }
}

export default World;
