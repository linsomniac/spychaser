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

export default MachineGun;
