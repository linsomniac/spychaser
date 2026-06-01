// entities/hazards.js
//
// Deployed field hazards (Phase 6, spec §6): an oil slick spins out pursuers,
// a smoke screen blinds them. These are the realized form of the rear specials
// from systems/weapons.js — once deployed they sit on the asphalt, scroll down
// with the road, and impair any enemy that drives over them.
//
// AIDEV-NOTE: Hazard collision reuses enemy.spinTimer / enemy.blindTimer (see
// entities/enemies.js). The base Enemy.update() already honors those timers, so
// applying a hazard is just "set the timer"; the existing steering logic handles
// the spin-out / blind behavior. Pure & canvas-free (draw() is the only canvas
// part), so the collision hooks are unit-tested headlessly.

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { aabbOverlap } from "../systems/collision.js";

const HAZARD_KINDS = ["oil", "smoke"];

/**
 * A deployed field hazard. Position is the CENTER (matching enemies/player);
 * `bounds` returns a top-left AABB for collidePairs()/aabbOverlap().
 */
export class Hazard {
  /**
   * @param {"oil"|"smoke"} kind
   * @param {number} x center x, virtual px
   * @param {number} y center y, virtual px
   * @param {{config?: typeof config}} [opts]
   */
  constructor(kind, x, y, opts = {}) {
    const cfg = opts.config ?? config;
    const def = cfg.weapons.specials[kind];
    if (!def || !HAZARD_KINDS.includes(kind)) {
      throw new Error(`unknown hazard: ${kind}`);
    }
    this.config = cfg;
    this.def = def;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.width = def.width;
    this.height = def.height;
    /** seconds of life remaining before it fades off the road. */
    this.life = def.life;
    /** true while live; collision/cull use this (collision skips active===false). */
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
   * Draw the hazard as a flat blob on the asphalt. Only canvas-touching method.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    ctx.save();
    // Fade out over the last portion of life.
    const fade = Math.min(1, this.life / 0.8);
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = this.kind === "oil" ? palette.enemyAccent : palette.smoke;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.width / 2, this.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Factory for a deployed hazard.
 * @param {"oil"|"smoke"} kind
 * @param {number} x center x, virtual px
 * @param {number} y center y, virtual px
 * @param {{config?: typeof config}} [opts]
 * @returns {Hazard}
 */
export function createHazard(kind, x, y, opts) {
  return new Hazard(kind, x, y, opts);
}

/**
 * Advance a hazard by one step: scroll it down with the road and age it. When
 * its life runs out it is deactivated (the world culls inactive hazards).
 * @param {Hazard} h
 * @param {number} dt seconds
 * @param {number} [scrollSpeed] road scroll, virtual px/s (so it stays pinned to
 *   the asphalt and slides off the bottom of the screen).
 */
export function tickHazard(h, dt, scrollSpeed = config.road.baseScrollSpeed) {
  if (!h.active) return;
  h.y += scrollSpeed * dt;
  h.life -= dt;
  if (h.life <= 0) {
    h.life = 0;
    h.active = false;
  }
}

/**
 * Apply a hazard's effect to an enemy that overlaps it. Oil spins the enemy out
 * (loses control); smoke blinds it (loses tracking). Idempotent-ish: it raises
 * the timer to at least the configured duration (re-touching refreshes it).
 * @param {Hazard} h
 * @param {{active?:boolean, dead?:boolean, bounds:object, spinTimer:number, blindTimer:number}} enemy
 * @returns {boolean} whether the enemy was affected this call.
 */
export function applyHazardToEnemy(h, enemy) {
  if (!h.active) return false;
  if (enemy.active === false || enemy.dead) return false;
  if (!aabbOverlap(h.bounds, enemy.bounds)) return false;
  if (h.kind === "oil") {
    enemy.spinTimer = Math.max(enemy.spinTimer ?? 0, h.def.spinDuration);
  } else {
    enemy.blindTimer = Math.max(enemy.blindTimer ?? 0, h.def.blindDuration);
  }
  return true;
}

export default Hazard;
