// core/world.js
//
// The simulation world: the single source of truth for game state. It is kept
// completely decoupled from Canvas and requestAnimationFrame so it can be unit
// tested headlessly. The loop calls `world.update(dt)` with a fixed step; the
// renderer reads from the world but never mutates it.
//
// AIDEV-NOTE: Phase 0 stub. This holds just enough state to prove the engine
// harness works end-to-end (seeded RNG, a tick counter, elapsed time). Later
// phases (road, player, enemies, weapons, director, scoring) flesh it out.

import { createRng } from "../engine/rng.js";
import { config } from "../data/config.js";

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
    /** @type {import("../engine/rng.js").Rng} */
    this.rng = createRng(options.seed ?? 1);

    /** virtual play-field dimensions, mirrored for convenience */
    this.width = this.config.VIRTUAL_WIDTH;
    this.height = this.config.VIRTUAL_HEIGHT;

    /** seconds of simulated time elapsed */
    this.time = 0;
    /** number of fixed update ticks executed */
    this.ticks = 0;
    /** total virtual px the world has scrolled (proxy for distance) */
    this.distance = 0;
    /** simple lifecycle flag; later phases add menu/playing/gameover */
    this.state = "playing";
  }

  /**
   * Advance the simulation by exactly `dt` seconds (the loop's fixed step).
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.state !== "playing") return;
    this.time += dt;
    this.ticks += 1;
    this.distance += this.config.road.baseScrollSpeed * dt;
  }

  /**
   * Reset to an initial state. Optionally reseed for a fresh deterministic run.
   * @param {number} [seed]
   */
  reset(seed) {
    if (seed !== undefined) {
      this.rng = createRng(seed);
    }
    this.time = 0;
    this.ticks = 0;
    this.distance = 0;
    this.state = "playing";
  }
}

export default World;
