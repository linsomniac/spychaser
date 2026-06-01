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

// ---------------------------------------------------------------------------
// Phase 7 — Mad Bomber helicopter (spec §6) + dropped bombs.
//
// AIDEV-NOTE: The helicopter is an AERIAL set-piece, not road traffic, so it is
// NOT an Enemy subclass — it has its own phase machine and is IMMUNE to bullets
// (damage() always returns false). It is destroyed ONLY by missiles, via the
// dedicated missileHit() method (driven by systems/collision.js
// resolveMissilesVsHelicopter). Phases:
//   ENTERING — descends from above to its hover line.
//   TRACKING — hovers at hoverY, chases the player's x, drops bombs on a timer.
//   LEAVING  — flies straight up off-screen once defeated.
// update(dt, world) mirrors the Enemy contract: it returns a list of events
// (here only { type:"bomb", x, y }) that the World realizes into Bomb entities.
// ---------------------------------------------------------------------------
export const HELI_PHASE = Object.freeze({
  ENTERING: "entering",
  TRACKING: "tracking",
  LEAVING: "leaving",
});

export class Helicopter {
  /**
   * @param {number} x spawn lateral center, virtual px
   * @param {number} [y] spawn y (defaults to just above the top edge)
   * @param {{config?: typeof config}} [opts]
   */
  constructor(x, y, opts = {}) {
    const cfg = opts.config ?? config;
    /** @type {typeof config} */
    this.config = cfg;
    const def = cfg.helicopter;
    this.def = def;
    this.type = "helicopter";
    this.width = def.width;
    this.height = def.height;
    this.x = x;
    this.y = y ?? -def.height;
    this.hp = def.hp;
    // AIDEV-NOTE: bulletproof so the world's player-bullet collision pass (which
    // calls enemy.damage()) never harms it; missiles use missileHit() instead.
    this.bulletproof = true;
    this.active = true;
    this.dead = false;
    this.phase = HELI_PHASE.ENTERING;
    // Seconds accumulated toward the next bomb drop (only counts while TRACKING).
    this.bombTimer = 0;
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
   * Advance the heli one step and return any drop events.
   * @param {number} dt seconds
   * @param {{player:{x:number,y:number}}} world
   * @returns {Array<{type:string,x:number,y:number}>}
   */
  update(dt, world) {
    const def = this.def;
    switch (this.phase) {
      case HELI_PHASE.ENTERING: {
        this.y += def.entrySpeed * dt;
        if (this.y >= def.hoverY) {
          // Clamp to the hover line (no overshoot) and begin tracking.
          this.y = def.hoverY;
          this.phase = HELI_PHASE.TRACKING;
          this.bombTimer = 0;
        }
        return [];
      }
      case HELI_PHASE.TRACKING: {
        // Lateral chase with a deadzone to avoid jitter when aligned.
        const dx = world.player.x - this.x;
        if (Math.abs(dx) > def.trackDeadzone) {
          this.x = approach(this.x, world.player.x, def.trackSpeed * dt);
        }
        // Bomb cadence: fire once per interval (SET, not subtract, so a big dt
        // can't dump a burst — mirrors the machine-gun cadence model).
        this.bombTimer += dt;
        if (this.bombTimer >= def.bombInterval) {
          this.bombTimer = 0;
          return [{ type: "bomb", x: this.x, y: this.y }];
        }
        return [];
      }
      case HELI_PHASE.LEAVING:
      default: {
        this.y -= def.leaveSpeed * dt;
        return [];
      }
    }
  }

  /**
   * Bullet damage. The helicopter is IMMUNE to bullets — always a no-op that
   * reports "not killed", matching the bulletproof Enemy contract used by the
   * world's player-bullet collision pass.
   * @returns {boolean} always false
   */
  // eslint-disable-next-line no-unused-vars
  damage(_amount = 1) {
    return false;
  }

  /**
   * Apply a MISSILE hit (the only thing that harms the heli, spec §6). Returns
   * true if this hit destroyed it; on death it is marked dead and switched to
   * LEAVING so it flies off-screen.
   * @param {number} [amount=1]
   * @returns {boolean} died this hit
   */
  missileHit(amount = 1) {
    if (this.dead) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      this.active = false;
      this.phase = HELI_PHASE.LEAVING;
      return true;
    }
    return false;
  }

  /**
   * True once the heli has flown above the top edge (LEAVING) and can be culled.
   * @param {number} _height play-field height (unused; heli leaves via the top)
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  isOffscreen(_height) {
    return this.y + this.height / 2 < -48;
  }

  /**
   * Draw the helicopter (rounded body + rotor disc). Only canvas-touching method.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const { x, y, width: w, height: h } = this;
    ctx.save();
    // Soft shadow on the road below.
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.7, w * 0.42, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Rotor disc.
    ctx.strokeStyle = palette.hudDim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.62, h * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Body.
    ctx.fillStyle = palette.enemyHeavy;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.28, h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cockpit glass.
    ctx.fillStyle = palette.enemyAccent;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.12, w * 0.16, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// AIDEV-NOTE: Bombs dropped by the helicopter. They fall straight down and
// detonate at road level (config.bomb.detonateY * VIRTUAL_HEIGHT), then expose a
// circular blast for blastDuration seconds during which the world's collision
// pass damages the player. update() ages + falls + detonates; blast() returns
// the live blast circle (or null). The collision pass guards single application
// via blastApplied (see systems/collision.js resolveBombBlast).
export class Bomb {
  /**
   * @param {number} x center x, virtual px
   * @param {number} y center y, virtual px
   * @param {{config?: typeof config}} [opts]
   */
  constructor(x, y, opts = {}) {
    const cfg = opts.config ?? config;
    this.config = cfg;
    const def = cfg.bomb;
    this.def = def;
    this.type = "bomb";
    this.x = x;
    this.y = y;
    this.vy = def.fallSpeed;
    this.width = def.width;
    this.height = def.height;
    this.radius = def.blastRadius;
    this.detonateY = def.detonateY * cfg.VIRTUAL_HEIGHT;
    this.active = true;
    this.detonated = false;
    /** set by collision.js once the blast has been applied (single-shot). */
    this.blastApplied = false;
    this.blastTimer = 0; // counts down the blast window after detonation
    this.age = 0;
  }

  /** Top-left AABB for the falling bomb (used for rendering / future hits). */
  get bounds() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      w: this.width,
      h: this.height,
    };
  }

  /**
   * Advance the bomb one step: fall until it reaches road level, detonate, then
   * run out the blast window before deactivating.
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.active) return;
    this.age += dt;
    if (!this.detonated) {
      this.y += this.vy * dt;
      if (this.y >= this.detonateY || this.age >= this.def.ttl) {
        this.detonated = true;
        this.blastTimer = this.def.blastDuration;
      }
    } else {
      this.blastTimer -= dt;
      if (this.blastTimer <= 0) this.active = false;
    }
  }

  /**
   * The live blast circle while detonated, else null.
   * @returns {{x:number,y:number,r:number}|null}
   */
  blast() {
    if (!this.detonated) return null;
    return { x: this.x, y: this.y, r: this.radius };
  }

  /** True once the bomb is spent (blast window elapsed). */
  isOffscreen() {
    return !this.active;
  }

  /**
   * Draw the bomb (falling) or its expanding blast (detonated).
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    ctx.save();
    if (!this.detonated) {
      ctx.fillStyle = palette.enemyAccent;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const t = Math.max(0, this.blastTimer / this.def.blastDuration);
      ctx.globalAlpha = 0.55 * t;
      ctx.fillStyle = palette.explosion;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * Factory: build the right Enemy subclass for a type key.
 * @param {string} type one of ENEMY_TYPES (or "helicopter")
 * @param {number} x spawn lateral center
 * @param {{config?: typeof config}} [opts]
 * @returns {Enemy|Helicopter}
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
    case "helicopter":
      return new Helicopter(x, undefined, opts);
    default:
      throw new Error(`unknown enemy type: ${type}`);
  }
}

export default createEnemy;
