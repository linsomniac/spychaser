// entities/enemies.js
//
// Phase 4 ground-enemy cast (spec §6 "Enemies"):
//   * Switchblade  — pulls alongside the player and slashes its tires.
//   * Enforcer     — bulletproof; must be rammed off the road.
//   * Road Lord    — armed car that returns fire.
//   * Barrel Dumper— truck that drops rolling barrels.
//
// Each enemy is a small class with the common entity interface used elsewhere
// (player.js): `update(dt, world)`, `draw(ctx)`, a `bounds` AABB accessor, and
// an `active` flag. Per-enemy steering/attack logic is PURE and canvas-free so
// it is unit-tested headlessly; draw() is the only canvas-touching method.
//
// AIDEV-NOTE: Coordinate convention matches the renderer — +y is DOWN. Enemies
// spawn above the top edge (config.enemies.spawnY < 0) and drive DOWN at
// `approachSpeed` (slower than the road scroll) so, relative to the player, they
// hang near the top and fall back. They steer laterally toward the player's x.
//
// AIDEV-NOTE: Attacks (Road Lord fire, Barrel Dumper drops, Switchblade slash)
// are returned from update() as a list of EVENTS rather than mutating pools
// directly. The world realizes them. This keeps behavior testable without wiring
// projectile pools into the enemy. Event shapes:
//   { type:"enemyBullet", x, y, vx, vy }
//   { type:"barrel", x, y }
//   { type:"slash", enemy }       (instantaneous; world applies player damage)

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { drawVehicle } from "../render/shapes.js";

/** The four Phase-4 enemy type keys (also keys into config.enemies). */
export const ENEMY_TYPES = ["switchblade", "enforcer", "roadLord", "barrelDumper"];

const ENEMY_COLORS = {
  switchblade: palette.enemy,
  enforcer: palette.enemyHeavy,
  roadLord: palette.enemy,
  barrelDumper: palette.enemyHeavy,
};

/**
 * Move a value toward a target by at most `step` (no overshoot). Shared steering
 * helper; pure.
 * @param {number} value
 * @param {number} target
 * @param {number} step  max change this call (>= 0)
 * @returns {number}
 */
export function approach(value, target, step) {
  const d = target - value;
  if (Math.abs(d) <= step) return target;
  return value + Math.sign(d) * step;
}

/**
 * Base ground enemy. Subclasses override `behave(dt, world)` to add attacks.
 */
export class Enemy {
  /**
   * @param {string} type one of ENEMY_TYPES
   * @param {number} x spawn lateral center, virtual px
   * @param {{config?: typeof config}} [opts]
   */
  constructor(type, x, opts = {}) {
    const cfg = opts.config ?? config;
    const def = cfg.enemies[type];
    if (!def) throw new Error(`unknown enemy type: ${type}`);
    /** @type {typeof config} */
    this.config = cfg;
    this.type = type;
    this.def = def;
    this.width = def.width;
    this.height = def.height;
    this.x = x;
    this.y = cfg.enemies.spawnY;
    this.hp = def.hp;
    this.bulletproof = !!def.bulletproof;
    /** true while live; collision/cull use this. */
    this.active = true;
    /** set true the frame it dies; world spawns an explosion + scores + culls. */
    this.dead = false;
    // AIDEV-NOTE: attack timer starts at 0 (ready) so an enemy attacks at its
    // first eligible tick (e.g. a Road Lord that pulls up starts firing
    // promptly), then re-arms to the per-type cooldown. behave() decrements this
    // each tick and fires when it reaches 0.
    this.cooldown = 0;
    // AIDEV-NOTE: Phase 6 hazard effects. While `spinTimer > 0` the enemy has
    // lost control (oil slick) and does NOT steer toward the player — it just
    // drifts down. While `blindTimer > 0` the enemy is blinded (smoke) and also
    // cannot track the player's lane. Both decay in update(). entities/hazards.js
    // sets them via applyHazardToEnemy().
    this.spinTimer = 0;
    this.blindTimer = 0;
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
   * Advance the enemy one step. Applies the common downward drift + lateral
   * steering toward the player, then runs the subclass attack behavior.
   * Returns the list of attack events (possibly empty).
   * @param {number} dt seconds
   * @param {{player:{x:number,y:number}}} world
   * @returns {Array<object>}
   */
  update(dt, world) {
    if (!this.active || this.dead) return [];
    // Common downward drift.
    this.y += this.def.approachSpeed * dt;
    // AIDEV-NOTE: spun-out (oil) or blinded (smoke) enemies cannot steer toward
    // the player; they just drift. Decay both timers each tick. While impaired
    // the attack behavior is also suppressed (a spinning/blind enemy can't
    // line up a slash/shot).
    const impaired = this.spinTimer > 0 || this.blindTimer > 0;
    if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt);
    if (this.blindTimer > 0) this.blindTimer = Math.max(0, this.blindTimer - dt);
    if (impaired) return [];
    // Steer toward the player's lane.
    this.x = approach(this.x, world.player.x, this.def.steerSpeed * dt);
    return this.behave(dt, world) ?? [];
  }

  /** Subclass hook for attacks. Default: no attack. */
  // eslint-disable-next-line no-unused-vars
  behave(dt, world) {
    return [];
  }

  /**
   * Apply bullet damage. Bulletproof enemies are immune. Returns true if this
   * hit killed the enemy (caller spawns explosion + scores + culls).
   * @param {number} [amount=1]
   * @returns {boolean} died this hit
   */
  damage(amount = 1) {
    if (this.bulletproof) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      this.active = false;
      return true;
    }
    return false;
  }

  /**
   * True once the enemy has scrolled fully past the bottom edge and should be
   * culled.
   * @param {number} height play-field height, virtual px
   * @returns {boolean}
   */
  isOffscreen(height) {
    return this.y - this.height / 2 > height + 48;
  }

  /**
   * Draw the enemy as an oncoming vehicle (facing down toward the player).
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    drawVehicle(
      ctx,
      this.x,
      this.y,
      this.width,
      this.height,
      { body: ENEMY_COLORS[this.type] ?? palette.enemy, accent: palette.enemyAccent },
      { facing: -1, shadow: true },
    );
  }
}

/** Switchblade: matches the player's x; slashes when alongside (cooldowned). */
export class Switchblade extends Enemy {
  constructor(x, opts) {
    super("switchblade", x, opts);
  }

  behave(dt, world) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const dx = Math.abs(this.x - world.player.x);
    const dy = Math.abs(this.y - world.player.y);
    if (this.cooldown === 0 && dx <= this.def.slashRangeX && dy <= this.def.slashRangeY) {
      this.cooldown = this.def.slashCooldown;
      // AIDEV-NOTE: instantaneous slash; the world applies the hit to the player.
      return [{ type: "slash", enemy: this }];
    }
    return [];
  }
}

/** Enforcer: bulletproof; just rams (steering handled by the base update). */
export class Enforcer extends Enemy {
  constructor(x, opts) {
    super("enforcer", x, opts);
  }
}

/** Road Lord: periodically fires a bullet straight down at the player's lane. */
export class RoadLord extends Enemy {
  constructor(x, opts) {
    super("roadLord", x, opts);
  }

  behave(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown === 0) {
      this.cooldown = this.def.fireCooldown;
      return [
        {
          type: "enemyBullet",
          x: this.x,
          y: this.y + this.height / 2,
          vx: 0,
          vy: this.def.bulletSpeed,
        },
      ];
    }
    return [];
  }
}

/** Barrel Dumper: periodically drops a rolling barrel behind it. */
export class BarrelDumper extends Enemy {
  constructor(x, opts) {
    super("barrelDumper", x, opts);
  }

  behave(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown === 0) {
      this.cooldown = this.def.dropCooldown;
      return [{ type: "barrel", x: this.x, y: this.y + this.height / 2 }];
    }
    return [];
  }
}

/**
 * Factory: build the right Enemy subclass for a type key.
 * @param {string} type one of ENEMY_TYPES
 * @param {number} x spawn lateral center
 * @param {{config?: typeof config}} [opts]
 * @returns {Enemy}
 */
export function createEnemy(type, x, opts) {
  switch (type) {
    case "switchblade":
      return new Switchblade(x, opts);
    case "enforcer":
      return new Enforcer(x, opts);
    case "roadLord":
      return new RoadLord(x, opts);
    case "barrelDumper":
      return new BarrelDumper(x, opts);
    default:
      throw new Error(`unknown enemy type: ${type}`);
  }
}

export default createEnemy;
