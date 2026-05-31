// entities/civilian.js
//
// Civilian cars (spec §6 "Civilians"): grey, neutral, pass-through traffic that
// must NOT be destroyed. Driving through one does no damage; shooting one incurs
// a score penalty and suspends the bonus (full lives logic in Phase 10).
//
// Same entity interface as the player/enemies: `update(dt, world)`, `draw(ctx)`,
// a `bounds` AABB accessor, and an `active` flag. Pure logic (RNG injected for
// the lane drift) so it's unit-testable; draw() is the only canvas-touching bit.
//
// AIDEV-NOTE: +y is DOWN. Civilians enter from the top and cruise DOWN slower
// than the road scroll so they fall behind. They drift gently toward a wandering
// lateral target re-rolled on a timer using the injected RNG + road bounds, so a
// seed reproduces their motion exactly.

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { drawVehicle } from "../render/shapes.js";
import { approach } from "./enemies.js";

export class Civilian {
  /**
   * @param {number} x spawn lateral center, virtual px
   * @param {number} targetX initial drift target, virtual px
   * @param {{config?: typeof config}} [opts]
   */
  constructor(x, targetX, opts = {}) {
    const cfg = opts.config ?? config;
    const def = cfg.civilians;
    /** @type {typeof config} */
    this.config = cfg;
    this.def = def;
    this.type = "civilian";
    this.width = def.width;
    this.height = def.height;
    this.x = x;
    this.y = def.spawnY;
    this.targetX = targetX;
    this.driftTimer = def.driftInterval;
    this.active = true;
  }

  /** Top-left AABB for collision (center-based position). */
  get bounds() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      w: this.width,
      h: this.height,
    };
  }

  /**
   * Advance one step: cruise down, drift toward the wandering target, and re-roll
   * the target on the timer (using world.rng + world.road bounds if available).
   * @param {number} dt seconds
   * @param {{rng?:object, road?:object, distance?:number}} [world]
   */
  update(dt, world) {
    const def = this.def;
    this.y += def.approachSpeed * dt;
    this.x = approach(this.x, this.targetX, def.driftSpeed * dt);

    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTimer = def.driftInterval;
      if (world && world.rng && world.road) {
        // AIDEV-NOTE: sample the road at the civilian's own row so the new drift
        // target stays on the asphalt (consistent with the renderer's y->distance
        // mapping). Falls back gracefully when no distance is supplied.
        const dist =
          (world.distance ?? 0) + (this.config.VIRTUAL_HEIGHT - this.y);
        const s = world.road.sampleAt(dist);
        const half = this.width / 2;
        this.targetX = world.rng.range(s.leftEdge + half, s.rightEdge - half);
      }
    }
  }

  /**
   * True once the civilian has scrolled past the bottom edge.
   * @param {number} height play-field height, virtual px
   * @returns {boolean}
   */
  isOffscreen(height) {
    return this.y - this.height / 2 > height + 48;
  }

  /**
   * Draw as a grey oncoming car.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    drawVehicle(
      ctx,
      this.x,
      this.y,
      this.width,
      this.height,
      { body: palette.civilian, accent: palette.civilianAccent ?? palette.hudDim },
      { facing: -1, shadow: true },
    );
  }
}

export default Civilian;
