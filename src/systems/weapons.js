// systems/weapons.js
//
// Player weapons. Phase 3 implements the machine gun: forward autofire with a
// fixed cadence (hold Space). The cadence logic is pure and canvas-free so it is
// unit-tested headlessly; the actual bullet spawning is delegated to the caller
// (which owns the projectile pool) via makeBulletSpec(). Special weapons
// (missiles/oil/smoke) are added in a later phase.
//
// AIDEV-NOTE: Cadence model. The gun tracks a `cooldown` countdown. A cold gun
// (cooldown <= 0) fires immediately when the trigger is held, then re-arms the
// cooldown. While held, it fires once each time the cooldown lapses — but at
// most ONE shot per update() call, so a huge dt can never dump a burst (the
// classic "spiral of death" magazine-dump bug). Releasing the trigger zeroes the
// cooldown so a fresh press fires instantly again (responsive feel).

import { config } from "../data/config.js";

const P = config.player;
const BULLET = config.weapons.bullet;

export class MachineGun {
  constructor() {
    // Seconds until the gun can fire again. <= 0 means ready.
    this.cooldown = 0;
    // Whether the trigger was held on the previous update (edge detection).
    this._wasFiring = false;
  }

  /**
   * Advance the gun by one tick.
   * @param {number} dt seconds.
   * @param {boolean} firing whether the fire input is held this tick.
   * @returns {number} number of shots emitted this tick (0 or 1).
   */
  update(dt, firing) {
    // Always cool down toward ready.
    if (this.cooldown > 0) this.cooldown -= dt;

    if (!firing) {
      // Released: go cold so the next press fires immediately.
      this.cooldown = 0;
      this._wasFiring = false;
      return 0;
    }

    let shots = 0;
    if (this.cooldown <= 0) {
      shots = 1;
      // AIDEV-NOTE: re-arm by SETTING (not subtracting) so a single large dt
      // yields at most one shot — no burst dump regardless of frame time.
      this.cooldown = P.fireCooldown;
    }
    this._wasFiring = true;
    return shots;
  }

  /** True if the gun is ready to fire right now. */
  get ready() {
    return this.cooldown <= 0;
  }

  /**
   * Build a bullet spawn descriptor for the projectile pool.
   * @param {number} x muzzle X (virtual px, center).
   * @param {number} y muzzle Y (virtual px, center).
   * @returns {{x:number,y:number,vx:number,vy:number,category:string,
   *   damage:number,ttl:number}}
   */
  makeBulletSpec(x, y) {
    return {
      x,
      y,
      vx: 0,
      // Bullets travel toward the top of the screen (smaller y), so vy is
      // negative.
      vy: -BULLET.speed,
      category: "playerBullet",
      damage: BULLET.damage,
      ttl: BULLET.ttl,
    };
  }
}

/**
 * Fire the player's machine gun for this tick: tick the cadence and, if it
 * emits a shot, spawn a bullet from the player's nose into the projectile pool.
 * Returns the number of bullets spawned (0 or 1) so the caller can drive SFX /
 * muzzle particles.
 *
 * @param {MachineGun} gun
 * @param {number} dt
 * @param {boolean} firing
 * @param {{x:number,y:number,height:number}} player
 * @param {{spawn:(spec:object)=>object}} projectiles
 * @returns {{spawned:number, x:number, y:number}} muzzle info for effects.
 */
export function fireMachineGun(gun, dt, firing, player, projectiles) {
  const shots = gun.update(dt, firing);
  // Muzzle sits at the front (top) of the car.
  const muzzleX = player.x;
  const muzzleY = player.y - player.height / 2;
  if (shots > 0) {
    projectiles.spawn(gun.makeBulletSpec(muzzleX, muzzleY));
  }
  return { spawned: shots, x: muzzleX, y: muzzleY };
}

// ---------------------------------------------------------------------------
// Special weapons (Phase 6, spec §6 "Special-weapons arsenal")
//
// AIDEV-NOTE: Specials are PURE data descriptors. createSpecial builds one from
// config; loadRandomSpecial draws a kind from the pool using an INJECTED rng
// (the seeded createRng from engine/rng.js) so selection is deterministic and
// testable. Effects are returned as plain data (specialEffect) and REALIZED by
// the caller (spawn missile projectiles / deploy a field hazard). This keeps the
// module canvas-free and unit-tested headlessly, mirroring the machine gun.
// ---------------------------------------------------------------------------

const SPECIAL = config.weapons.specials;

/** Loadable special-weapon kinds, in fixed order (the van's draw pool). */
export const SPECIAL_KINDS = Object.freeze([...SPECIAL.kinds]);

const SPECIAL_NAMES = {
  missiles: "MISSILES",
  oil: "OIL SLICK",
  smoke: "SMOKE",
};

/**
 * Build a special-weapon descriptor for the player's loaded slot.
 * @param {string} kind one of SPECIAL_KINDS
 * @returns {{kind:string, name:string, slot:"front"|"rear", charge:number}}
 */
export function createSpecial(kind) {
  const def = SPECIAL[kind];
  if (!def) throw new Error(`unknown special: ${kind}`);
  return {
    kind,
    name: SPECIAL_NAMES[kind] ?? kind.toUpperCase(),
    slot: def.slot,
    charge: def.charge,
  };
}

/**
 * Draw a random special from the pool using an injected (seeded) RNG.
 * @param {{pick: (arr: ReadonlyArray<string>) => string}} rng
 * @returns {ReturnType<typeof createSpecial>}
 */
export function loadRandomSpecial(rng) {
  return createSpecial(rng.pick(SPECIAL_KINDS));
}

/**
 * Whether a loaded special can be fired for the requested trigger slot.
 * @param {{slot:string, charge:number}|null|undefined} special
 * @param {"front"|"rear"} slot
 * @returns {boolean}
 */
export function canUseSpecial(special, slot) {
  return !!special && special.slot === slot && special.charge > 0;
}

/**
 * Consume one charge of a special. Returns the special, or null if it could not
 * be consumed (null / already empty). Never drives charge negative.
 * @param {{charge:number}|null|undefined} special
 * @returns {object|null}
 */
export function consumeSpecial(special) {
  if (!special || special.charge <= 0) return null;
  special.charge -= 1;
  return special;
}

/**
 * Describe the effect of using a special, given the firing entity (the player,
 * center-based x/y with width/height). Returns plain data; the caller spawns the
 * resulting missile projectiles or deploys the field hazard.
 *
 *   missiles -> { type:"projectiles", slot:"front", projectiles:[...] }
 *   oil/smoke -> { type:"hazard", slot:"rear", hazard:kind, x, y }  (deployed
 *               behind/below the player, since +y is DOWN)
 *
 * @param {{kind:string, slot:string}} special
 * @param {{x:number, y:number, width:number, height?:number}} from
 * @returns {object}
 */
export function specialEffect(special, from) {
  const def = SPECIAL[special.kind];
  const cx = from.x;
  if (special.kind === "missiles") {
    const half = from.width / 2;
    const noseY = from.y - (from.height ?? 0) / 2;
    const make = (offset) => ({
      x: cx + offset,
      y: noseY,
      vx: 0,
      vy: -def.speed, // travels UP the screen
      width: def.width,
      height: def.height,
      damage: def.damage,
      category: "playerMissile",
      kind: "missile",
      active: true,
    });
    return {
      type: "projectiles",
      slot: "front",
      projectiles: [make(-half * def.spreadX), make(half * def.spreadX)],
    };
  }
  // Rear hazards deploy behind (below) the player.
  const rearY = from.y + (from.height ?? 0) / 2 + def.height / 2;
  return {
    type: "hazard",
    slot: "rear",
    hazard: special.kind,
    x: cx,
    y: rearY,
  };
}

export default MachineGun;
