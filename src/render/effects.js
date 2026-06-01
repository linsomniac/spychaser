// render/effects.js
//
// Pooled particle system for muzzle flashes, hit sparks, and (later) explosions
// and splashes. Particles are pure kinematic records advanced by velocity and
// aged by ttl; the system is canvas-free except for draw(), so the spawn/update/
// expire logic is unit-tested headlessly. All randomness flows through a seeded
// rng so bursts are deterministic.
//
// AIDEV-NOTE: Particles use a CENTER position (x, y) like bullets. draw() is the
// only canvas-touching method and is never exercised in tests. Bursts take an
// rng argument (not Math.random) to preserve determinism — same seed, same look.
//
// AIDEV-NOTE: engine/pool.js recycles instances but does not track live ones, so
// this system owns an `_active` array of checked-out particles (same pattern as
// entities/projectiles.js). update() walks it backwards for safe in-loop removal.

import { Pool } from "../engine/pool.js";
import { palette } from "../data/palette.js";

function makeParticle() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ttl: 1,
    age: 0,
    size: 2,
    color: "#ffffff",
    // Optional drag (per second) to ease velocity toward zero; 0 = none.
    drag: 0,
    active: false,
  };
}

function resetParticle(p) {
  p.x = 0;
  p.y = 0;
  p.vx = 0;
  p.vy = 0;
  p.ttl = 1;
  p.age = 0;
  p.size = 2;
  p.color = "#ffffff";
  p.drag = 0;
  p.active = true;
}

export class ParticleSystem {
  constructor(opts = {}) {
    const capacity = opts.capacity ?? 128;
    this._pool = new Pool(makeParticle, resetParticle, capacity);
    /** @type {object[]} live, checked-out particles */
    this._active = [];
  }

  /** Number of live particles. */
  get activeCount() {
    return this._active.length;
  }

  /**
   * Spawn one particle.
   * @param {{x:number,y:number,vx:number,vy:number,ttl:number,size:number,
   *   color:string,drag?:number}} spec
   * @returns {object}
   */
  spawn(spec) {
    const p = this._pool.acquire();
    p.x = spec.x;
    p.y = spec.y;
    p.vx = spec.vx ?? 0;
    p.vy = spec.vy ?? 0;
    p.ttl = spec.ttl ?? 1;
    p.age = 0;
    p.size = spec.size ?? 2;
    p.color = spec.color ?? "#ffffff";
    p.drag = spec.drag ?? 0;
    this._active.push(p);
    return p;
  }

  /**
   * Advance all particles, aging and moving them; expire any past their ttl.
   * @param {number} dt
   */
  update(dt) {
    // Backwards walk so swap-with-last removal is safe mid-iteration.
    for (let i = this._active.length - 1; i >= 0; i--) {
      const p = this._active[i];
      p.age += dt;
      if (p.age >= p.ttl) {
        this._removeAt(i);
        continue;
      }
      if (p.drag > 0) {
        // Exponential-ish velocity decay; clamped so it never overshoots.
        const k = Math.min(1, p.drag * dt);
        p.vx -= p.vx * k;
        p.vy -= p.vy * k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /**
   * Remove the live particle at index i (swap-with-last) and recycle it.
   * @param {number} i
   * @private
   */
  _removeAt(i) {
    const p = this._active[i];
    const last = this._active.length - 1;
    if (i !== last) this._active[i] = this._active[last];
    this._active.pop();
    p.active = false;
    this._pool.release(p);
  }

  /**
   * Remaining-life fraction of a particle, 1 (fresh) -> 0 (about to die). Used
   * by draw() for fade-out; exposed for tests.
   * @param {object} p
   * @returns {number}
   */
  lifeFrac(p) {
    if (p.ttl <= 0) return 0;
    const f = 1 - p.age / p.ttl;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }

  /** Iterate live particles. */
  forEach(fn) {
    for (let i = 0; i < this._active.length; i++) fn(this._active[i]);
  }

  /** Release all particles (e.g. on restart). */
  clear() {
    for (let i = 0; i < this._active.length; i++) {
      const p = this._active[i];
      p.active = false;
      this._pool.release(p);
    }
    this._active.length = 0;
  }

  /**
   * Muzzle flash: a few short-lived sparks flung forward (upward) from the gun.
   * @param {number} x muzzle center x.
   * @param {number} y muzzle center y.
   * @param {{range:(a:number,b:number)=>number, int:(a:number,b:number)=>number}} rng
   */
  muzzleBurst(x, y, rng) {
    const count = rng.int(4, 6); // 4..6 sparks
    for (let i = 0; i < count; i++) {
      const spread = rng.range(-40, 40);
      this.spawn({
        x: x + rng.range(-2, 2),
        y: y + rng.range(-2, 2),
        vx: spread,
        vy: rng.range(-260, -120), // forward (up)
        ttl: rng.range(0.06, 0.14),
        size: rng.range(1.5, 3),
        color: palette.bullet,
        drag: 6,
      });
    }
  }

  /**
   * Hit spark: a small omnidirectional burst at an impact point.
   * @param {number} x impact center x.
   * @param {number} y impact center y.
   * @param {{range:(a:number,b:number)=>number, int:(a:number,b:number)=>number}} rng
   * @param {string} [color] override spark color.
   */
  hitSpark(x, y, rng, color = palette.explosion) {
    const count = rng.int(6, 10); // 6..10 sparks
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const spd = rng.range(60, 200);
      this.spawn({
        x: x + rng.range(-3, 3),
        y: y + rng.range(-3, 3),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        ttl: rng.range(0.18, 0.4),
        size: rng.range(1.5, 3.5),
        color,
        drag: 5,
      });
    }
  }

  /**
   * Explosion burst (Phase 4): a larger, longer-lived omnidirectional spray of
   * fire + smoke shards for a destroyed enemy. Like hitSpark but bigger; pulls
   * from the same pooled particles so it stays GC-free and deterministic.
   * @param {number} x impact center x.
   * @param {number} y impact center y.
   * @param {{range:(a:number,b:number)=>number, int:(a:number,b:number)=>number}} rng
   */
  explosion(x, y, rng) {
    const count = rng.int(14, 20);
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const spd = rng.range(80, 320);
      // Mix fiery core sparks with darker smoke shards.
      const color = rng.next() < 0.65 ? palette.explosion : palette.smoke;
      this.spawn({
        x: x + rng.range(-4, 4),
        y: y + rng.range(-4, 4),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        ttl: rng.range(0.3, 0.6),
        size: rng.range(2, 5),
        color,
        drag: 4,
      });
    }
  }

  /**
   * Splash wake (Phase 8): a short-lived spray of foam particles kicked up at a
   * boat's stern as it cuts through the water. Particles fan upward + sideways
   * (the wake) so they trail behind the boat, then settle. Like hitSpark but in
   * the water-foam palette and biased upward (-vy). Pooled + deterministic.
   * @param {number} x wake center x.
   * @param {number} y wake center y.
   * @param {{range:(a:number,b:number)=>number, int:(a:number,b:number)=>number}} rng
   */
  splash(x, y, rng) {
    const count = rng.int(5, 9);
    for (let i = 0; i < count; i++) {
      // Fan mostly upward (the wake sprays back over the water surface).
      const spread = rng.range(-90, 90);
      this.spawn({
        x: x + rng.range(-6, 6),
        y: y + rng.range(-3, 3),
        vx: spread,
        vy: rng.range(-150, -40), // upward spray
        ttl: rng.range(0.22, 0.5),
        size: rng.range(1.5, 3.5),
        color: rng.next() < 0.7 ? palette.waterFoam : palette.water,
        drag: 4,
      });
    }
  }

  /**
   * Draw all live particles as soft, additively-blended round sparks that fade
   * out on an ease-out curve. Canvas-only; not unit-tested (no logic asserted),
   * so this is safe to tune for feel without touching the deterministic sim.
   *
   * AIDEV-NOTE: Phase 13 visual polish. Replaced the old hard 1px squares with
   * round dots + a quadratic ease-out alpha (lingers bright, snaps off at the
   * end) under a "lighter" composite so overlapping fire sparks bloom — the
   * modern flat-vector look (spec §7). Composite + alpha are restored after the
   * pass so the renderer's subsequent draws are unaffected.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this._active.length; i++) {
      const p = this._active[i];
      // Ease-out fade: stays vivid most of its life, then drops off quickly.
      const f = this.lifeFrac(p);
      ctx.globalAlpha = f * f;
      ctx.fillStyle = p.color;
      // A round spark grows slightly as it fades for a soft "puff" feel.
      const r = (p.size / 2) * (1 + (1 - f) * 0.4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevComposite;
  }
}

export default ParticleSystem;
