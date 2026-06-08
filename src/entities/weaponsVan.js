// entities/weaponsVan.js
//
// The weapons van set-piece (Phase 6, spec §6 "Weapons van"). It appears as a
// periodic set-piece (scheduled by systems/director.js) and drives down ahead
// of the player. When the player tucks into the van's open REAR ramp for enough
// continuous steps, a random special weapon is loaded into the player's slot.
//
// AIDEV-NOTE: Load logic is PURE and RNG-injected (loadRandomSpecial takes the
// seeded createRng) so it is deterministic in tests. updateVanLoad delivers AT
// MOST ONCE per van (the `delivered` guard) — re-entering a spent van does
// nothing. Position is CENTER-based (matching enemies/player); +y is DOWN, so
// the rear ramp is a band at the BOTTOM of the van's footprint.

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { aabbOverlap } from "../systems/collision.js";
import { loadRandomSpecial, createSpecial } from "../systems/weapons.js";

export class WeaponsVan {
  /**
   * @param {number} x center x, virtual px
   * @param {number} y center y, virtual px
   * @param {{config?: typeof config, loadFrames?: number}} [opts]
   */
  constructor(x, y, opts = {}) {
    const cfg = opts.config ?? config;
    const def = cfg.van;
    this.config = cfg;
    this.def = def;
    this.x = x;
    this.y = y;
    this.width = def.width;
    this.height = def.height;
    /** continuous steps tucked in the ramp needed to load a special. */
    this.loadFrames = opts.loadFrames ?? def.loadFrames;
    /** continuous-steps-in-ramp counter; resets when the player leaves. */
    this.loadProgress = 0;
    /** true once this van has handed over its single payload. */
    this.delivered = false;
    /** true while live; collision/cull use this. */
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
   * Advance the van's downward drift one step (it cruises like an enemy). The
   * load handshake is driven separately by updateVanLoad() so it can take the
   * player + rng without coupling them into the entity.
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.active) return;
    this.y += this.def.approachSpeed * dt;
  }

  /**
   * True once the van has scrolled fully past the bottom edge.
   * @param {number} height play-field height, virtual px
   * @returns {boolean}
   */
  isOffscreen(height) {
    return this.y - this.height / 2 > height + 64;
  }

  /**
   * Draw the van and its open rear ramp. Only canvas-touching method.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const b = this.bounds;
    ctx.save();
    // Body.
    ctx.fillStyle = palette.pickup;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Rear ramp catch zone (highlighted) so the player can see where to tuck in.
    const z = rampZone(this);
    ctx.fillStyle = palette.pickupRing;
    ctx.globalAlpha = this.delivered ? 0.25 : 0.6;
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.restore();
  }
}

/**
 * Factory for a weapons van.
 * @param {number} x center x, virtual px
 * @param {number} y center y, virtual px
 * @param {{config?: typeof config, loadFrames?: number}} [opts]
 * @returns {WeaponsVan}
 */
export function createWeaponsVan(x, y, opts) {
  return new WeaponsVan(x, y, opts);
}

/**
 * The rear ramp catch zone: a band at the van's rear (bottom, since +y is DOWN),
 * inset from the sides. Returned as a top-left AABB {x, y, w, h}.
 * @param {WeaponsVan} v
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function rampZone(v) {
  const b = v.bounds;
  const inset = v.def.rampInset;
  const rampHeight = v.def.rampHeight;
  return {
    x: b.x + inset,
    y: b.y + b.h - rampHeight,
    w: b.w - inset * 2,
    h: rampHeight,
  };
}

/**
 * Whether the player is tucked into the rear ramp.
 * @param {WeaponsVan} v
 * @param {{x:number,y:number,width:number,height:number}} player
 * @returns {boolean}
 */
export function inRamp(v, player) {
  const pb = {
    x: player.x - player.width / 2,
    y: player.y - player.height / 2,
    w: player.width,
    h: player.height,
  };
  return aabbOverlap(rampZone(v), pb);
}

/**
 * Advance the van's load handshake for one step. Returns a freshly loaded special
 * when delivery completes, else null.
 *
 *   - not in ramp        -> reset progress, return null
 *   - in ramp, building  -> bump progress, return null
 *   - in ramp, complete  -> mark delivered; return createSpecial(forceKind) if a
 *                           kind is forced (NO rng drawn), else loadRandomSpecial(rng)
 *   - already delivered  -> return null (one payload per van)
 *
 * @param {WeaponsVan} v
 * @param {{x:number,y:number,width:number,height:number}} player
 * @param {{pick:Function}} rng seeded RNG (engine/rng.js createRng)
 * @param {string|null} [forceKind] when set, deliver exactly this special kind
 *   without drawing the random kind from rng (spec §4.5 first-load guarantee).
 * @returns {object|null} a loaded special descriptor, or null
 */
export function updateVanLoad(v, player, rng, forceKind = null) {
  if (v.delivered || !v.active) return null;
  if (!inRamp(v, player)) {
    v.loadProgress = 0;
    return null;
  }
  v.loadProgress += 1;
  if (v.loadProgress >= v.loadFrames) {
    v.delivered = true;
    return forceKind ? createSpecial(forceKind) : loadRandomSpecial(rng);
  }
  return null;
}

export default WeaponsVan;
