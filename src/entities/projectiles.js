// entities/projectiles.js
//
// Pooled projectiles (machine-gun bullets for now; enemy bullets / barrels /
// bombs arrive in later phases). Bullets are plain pooled records — no per-shot
// allocation on the hot path. The system spawns, advances (travel), and expires
// them (TTL or off-field), and exposes the live set for collision + rendering.
//
// AIDEV-NOTE: A bullet's position (x, y) is its CENTER in virtual space; its
// `bounds` getter converts to the top-left AABB the collision system expects.
// Travel is purely velocity-integrated here; the spawn descriptor (vx, vy) is
// produced by systems/weapons.js so firing logic and motion stay decoupled.
//
// AIDEV-NOTE: engine/pool.js recycles object INSTANCES but does NOT track which
// are live, so this system keeps its own `_active` array of checked-out bullets.
// The pool supplies acquire()/release() for GC-free reuse; we iterate `_active`.
// update() walks `_active` backwards so in-loop removal (swap-with-last) is safe.
//
// AIDEV-NOTE (Phase 4): the same pool now carries three projectile kinds, keyed
// by `category`:
//   "playerBullet" — player machine-gun rounds, travel UP (vy < 0).
//   "enemyBullet"  — Road Lord rounds, travel DOWN (vy > 0).
//   "barrel"       — Barrel Dumper barrels, roll DOWN and ACCELERATE (ay > 0),
//                    using a circular hitbox (radius) instead of the rect bounds.
// Acceleration (ax, ay) is integrated each tick; bullets leave them 0 so their
// behavior is unchanged. resetBullet() restores all fields so a recycled slot
// never carries stale barrel state into a player round.

import { Pool } from "../engine/pool.js";
import { config } from "../data/config.js";

const B = config.weapons.bullet;

// Factory: a blank bullet record with a non-enumerable `bounds` getter so the
// collision system can read entity.bounds as a top-left AABB directly off the
// pooled object (whose (x,y) is a CENTER) without per-frame allocation.
function makeBullet() {
  const b = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    // Acceleration (used by barrels; 0 for bullets).
    ax: 0,
    ay: 0,
    w: B.width,
    h: B.height,
    // Circular hitbox radius for barrels; 0 means "use the rect bounds".
    radius: 0,
    ttl: 0,
    age: 0,
    damage: B.damage,
    category: "playerBullet",
    active: false,
  };
  Object.defineProperty(b, "bounds", {
    enumerable: false,
    get() {
      return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
    },
  });
  return b;
}

function resetBullet(b) {
  b.x = 0;
  b.y = 0;
  b.vx = 0;
  b.vy = 0;
  b.ax = 0;
  b.ay = 0;
  b.w = B.width;
  b.h = B.height;
  b.radius = 0;
  b.ttl = B.ttl;
  b.age = 0;
  b.damage = B.damage;
  b.category = "playerBullet";
  b.active = true;
}

export class Projectiles {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity] objects to preallocate in the pool.
   */
  constructor(opts = {}) {
    const capacity = opts.capacity ?? 64;
    this._pool = new Pool(makeBullet, resetBullet, capacity);
    /** @type {object[]} live, checked-out bullets */
    this._active = [];
  }

  /** Number of live projectiles. */
  get activeCount() {
    return this._active.length;
  }

  /**
   * Spawn a bullet from a descriptor (produced by weapons.js).
   * @param {{x:number,y:number,vx:number,vy:number,ttl?:number,damage?:number,
   *   category?:string,w?:number,h?:number}} spec
   * @returns {object} the live bullet record.
   */
  spawn(spec) {
    const b = this._pool.acquire();
    b.x = spec.x;
    b.y = spec.y;
    b.vx = spec.vx ?? 0;
    b.vy = spec.vy ?? 0;
    if (spec.ax !== undefined) b.ax = spec.ax;
    if (spec.ay !== undefined) b.ay = spec.ay;
    if (spec.ttl !== undefined) b.ttl = spec.ttl;
    if (spec.damage !== undefined) b.damage = spec.damage;
    if (spec.category !== undefined) b.category = spec.category;
    if (spec.w !== undefined) b.w = spec.w;
    if (spec.h !== undefined) b.h = spec.h;
    if (spec.radius !== undefined) b.radius = spec.radius;
    this._active.push(b);
    return b;
  }

  /**
   * Spawn an enemy bullet (travels downward; category "enemyBullet").
   * @param {number} x center x
   * @param {number} y center y
   * @param {number} vx
   * @param {number} vy downward velocity (> 0)
   * @param {typeof config} [cfg]
   * @returns {object}
   */
  spawnEnemyBullet(x, y, vx, vy, cfg = config) {
    const eb = cfg.hostiles.enemyBullet;
    return this.spawn({
      x,
      y,
      vx,
      vy,
      w: eb.width,
      h: eb.height,
      damage: eb.damage,
      ttl: eb.ttl,
      category: "enemyBullet",
    });
  }

  /**
   * Spawn a rolling barrel: starts slow, accelerates downward, circular hitbox.
   * @param {number} x center x
   * @param {number} y center y
   * @param {typeof config} [cfg]
   * @returns {object}
   */
  spawnBarrel(x, y, cfg = config) {
    const ba = cfg.hostiles.barrel;
    return this.spawn({
      x,
      y,
      vx: 0,
      vy: ba.initialSpeed,
      ax: 0,
      ay: ba.accel,
      w: ba.radius * 2,
      h: ba.radius * 2,
      radius: ba.radius,
      damage: ba.damage,
      ttl: ba.ttl,
      category: "barrel",
    });
  }

  /**
   * Advance all bullets: integrate motion, age them, and expire any that exceed
   * their TTL or leave the play field (with a margin so off-screen shots die).
   * @param {number} dt
   */
  update(dt) {
    const { VIRTUAL_WIDTH: W, VIRTUAL_HEIGHT: H } = config;
    const margin = 32;
    // Backwards walk: swap-with-last removal is safe mid-iteration.
    for (let i = this._active.length - 1; i >= 0; i--) {
      const b = this._active[i];
      b.age += dt;
      // Integrate acceleration first (barrels speed up; bullets have ax=ay=0).
      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (
        b.age >= b.ttl ||
        b.y + b.h / 2 < -margin ||
        b.y - b.h / 2 > H + margin ||
        b.x + b.w / 2 < -margin ||
        b.x - b.w / 2 > W + margin
      ) {
        this._removeAt(i);
      }
    }
  }

  /**
   * Despawn a bullet (e.g. on impact). Removes it from the live set and returns
   * it to the pool so collision passes skip it immediately.
   * @param {object} b
   */
  kill(b) {
    const i = this._active.indexOf(b);
    if (i >= 0) this._removeAt(i);
  }

  /**
   * Remove the live bullet at index i (swap-with-last) and recycle it.
   * @param {number} i
   * @private
   */
  _removeAt(i) {
    const b = this._active[i];
    const last = this._active.length - 1;
    if (i !== last) this._active[i] = this._active[last];
    this._active.pop();
    b.active = false;
    this._pool.release(b);
  }

  /**
   * Iterate live bullets.
   * @param {(b:object) => void} fn
   */
  forEach(fn) {
    for (let i = 0; i < this._active.length; i++) fn(this._active[i]);
  }

  /**
   * The live bullets as an array for the collision broad phase (which expects an
   * indexable group). Returns the internal array directly — do NOT mutate it
   * outside this class; use kill() to despawn during a collision pass.
   * @returns {object[]}
   */
  toArray() {
    return this._active;
  }

  /** AABB top-left bounds for a bullet record (center-based position). */
  static boundsOf(b) {
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  /** Release every live bullet (e.g. on restart). */
  clear() {
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      b.active = false;
      this._pool.release(b);
    }
    this._active.length = 0;
  }
}

export default Projectiles;
