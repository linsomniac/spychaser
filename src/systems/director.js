// systems/director.js
//
// The spawn director (spec §6 "Set-pieces / progression", §10). It schedules
// enemy/civilian traffic by distance — difficulty escalating as the run goes on
// — and queues set-pieces (weapons van, enemy waves, water, weather, helicopter)
// at distance milestones. Everything is driven by the seeded world RNG, so the
// same seed yields the same schedule.
//
// AIDEV-NOTE: This module is PURE LOGIC, decoupled from Canvas / raf / the
// projectile pools (spec §5). `update(dt, ctx)` advances internal timers from the
// world's scroll distance and RETURNS a list of event objects; the World realizes
// them into actual enemies/civilians/set-piece triggers. This mirrors the
// "behavior returns events" pattern used by entities/enemies.js and keeps the
// scheduler unit-testable headlessly with a stub road + seeded RNG.
//
// Event shapes returned from update():
//   { kind: "enemy",    type, x }        // enemy type key + lateral spawn center
//   { kind: "civilian", x }              // lateral spawn center
//   { kind: "setpiece", name }           // milestone name (van/wave/water/...)

import { config } from "../data/config.js";
import { ENEMY_TYPES } from "../entities/enemies.js";

// AIDEV-NOTE: Pick-pool order is INTENTIONALLY different from ENEMY_TYPES.
// ENEMY_TYPES is ["switchblade","enforcer","roadLord","barrelDumper"] (config
// key order). For escalation we want the *easiest* types to unlock first:
//   Switchblade -> Road Lord -> Barrel Dumper -> Enforcer (bulletproof, hardest).
// enemyUnlock[].count indexes into THIS array, not ENEMY_TYPES. Every name here
// must still be a valid ENEMY_TYPES entry (asserted at module load).
const PICK_ORDER = ["switchblade", "roadLord", "barrelDumper", "enforcer"];
for (const t of PICK_ORDER) {
  if (!ENEMY_TYPES.includes(t)) {
    throw new Error(`director PICK_ORDER has unknown enemy type: ${t}`);
  }
}

/** Linear interpolation. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp x into [lo, hi]. */
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * The spawn director. Construct once per run; feed it the seeded world RNG via
 * update()'s context so the schedule is reproducible from the seed.
 */
export class Director {
  /** @param {{config?: typeof config}} [opts] */
  constructor(opts = {}) {
    /** @type {typeof config} */
    this.config = opts.config ?? config;
    const d = this.config.director;

    // Cadence countdown for normal traffic. Starts at the slow (max) interval so
    // the first wave doesn't appear at distance 0 (the warmup gate also guards
    // this).
    this.spawnTimer = d.maxInterval;

    // AIDEV-NOTE: each set-piece tracks the NEXT distance it should fire at.
    // These are seeded lazily on the first update() (initSetpieces) so the
    // firstAt jitter is drawn from the world RNG in a fixed key order, making the
    // whole schedule a pure function of the seed. null === "not yet seeded".
    /** @type {Record<string, number|null>} */
    this.nextSetpiece = {};
    for (const name of Object.keys(d.setpieces)) this.nextSetpiece[name] = null;
    this._initialized = false;
  }

  /**
   * Difficulty fraction in [0,1] from distance: 0 at the start, 1 once the
   * player passes rampDistance.
   * @param {number} distance
   * @returns {number}
   */
  difficulty(distance) {
    return clamp(distance / this.config.director.rampDistance, 0, 1);
  }

  /**
   * Number of enemy types unlocked at a given distance (count into PICK_ORDER).
   * @param {number} distance
   * @returns {number}
   */
  unlockedEnemyCount(distance) {
    let count = 1;
    for (const stage of this.config.director.enemyUnlock) {
      if (distance >= stage.distance) count = stage.count;
    }
    return clamp(count, 1, PICK_ORDER.length);
  }

  /** Current cadence interval (seconds) — shrinks with difficulty. */
  currentInterval(distance) {
    const d = this.config.director;
    return lerp(d.maxInterval, d.minInterval, this.difficulty(distance));
  }

  /**
   * Seed each set-piece's first trigger distance from the RNG, in a stable key
   * order, so the schedule is fully determined by the seed.
   * @param {import("../engine/rng.js").Rng} rng
   * @private
   */
  initSetpieces(rng) {
    const sp = this.config.director.setpieces;
    for (const name of Object.keys(sp)) {
      const cfg = sp[name];
      this.nextSetpiece[name] = cfg.firstAt + rng.range(0, cfg.jitter);
    }
    this._initialized = true;
  }

  /**
   * Pick a lateral spawn x around the road center, kept on the asphalt.
   * @param {object} road  road sampler with sampleAt(distance)
   * @param {number} distance  scroll distance to sample at (top of field)
   * @param {number} halfVehicle  half the vehicle width (keep it on-road)
   * @param {import("../engine/rng.js").Rng} rng
   * @returns {number}
   * @private
   */
  pickLane(road, distance, halfVehicle, rng) {
    const s = road.sampleAt(distance);
    const spread = (s.width / 2) * this.config.director.laneSpread;
    // Clamp the spawn band so the vehicle body stays inside the road edges.
    const lo = Math.max(s.leftEdge + halfVehicle, s.centerX - spread);
    const hi = Math.min(s.rightEdge - halfVehicle, s.centerX + spread);
    if (hi <= lo) return s.centerX; // degenerate narrow road; spawn on center
    return rng.range(lo, hi);
  }

  /**
   * Advance the director by one tick and return the events to realize.
   *
   * @param {number} dt seconds
   * @param {object} ctx
   * @param {number} ctx.distance  total scroll distance (virtual px)
   * @param {number} ctx.speed     current scroll speed (virtual px/s)
   * @param {object} ctx.road      road sampler (sampleAt(distance))
   * @param {import("../engine/rng.js").Rng} ctx.rng  seeded world RNG
   * @returns {Array<object>} events (possibly empty)
   */
  update(dt, ctx) {
    const { distance, speed, road, rng } = ctx;
    const d = this.config.director;
    const events = [];

    if (!this._initialized) this.initSetpieces(rng);

    // --- Set-pieces (distance-driven). ---
    // Fire any whose next-distance has been reached, then schedule the next one.
    // A while-loop catches the (rare) case of a large jump crossing multiple
    // cadences so spacing stays deterministic.
    for (const name of Object.keys(d.setpieces)) {
      const cfg = d.setpieces[name];
      while (distance >= this.nextSetpiece[name]) {
        events.push({ kind: "setpiece", name });
        // AIDEV-NOTE: advance by spacing +/- seeded jitter. Drawing the jitter
        // here (in fixed key order, inside the loop) keeps the sequence a pure
        // function of the seed.
        this.nextSetpiece[name] += cfg.spacing + rng.range(-cfg.jitter, cfg.jitter);
      }
    }

    // --- Traffic spawns (cadence + distance gated). ---
    // No traffic while stopped or before the warmup distance.
    if (speed <= 0 || distance < d.warmupDistance) return events;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // Reset to the current cadence (SET, not subtract) so a big dt can't bank
      // a burst of spawns in one tick.
      this.spawnTimer = this.currentInterval(distance);
      events.push(this.decideSpawn(ctx));
    }

    return events;
  }

  /**
   * Decide a single traffic spawn (enemy or civilian) and return its event.
   *
   * AIDEV-NOTE: RNG draw order is fixed for determinism — the vehicle roll is
   * drawn first, then (for an enemy) the type roll, then the lane. Changing this
   * order changes every seeded schedule, so keep it stable.
   * @param {object} ctx  same context object as update()
   * @returns {object} an "enemy" or "civilian" event
   * @private
   */
  decideSpawn(ctx) {
    const { distance, road, rng } = ctx;
    const d = this.config.director;

    const civChance = lerp(
      d.civilianChanceStart,
      d.civilianChanceEnd,
      this.difficulty(distance),
    );

    // Spawn row is just above the top edge (matches enemies/civilians spawnY).
    // Sample the road at that row so lanes line up with the rendered top.
    const sampleDistance = distance + this.config.VIRTUAL_HEIGHT;

    if (rng.next() < civChance) {
      const half = this.config.civilians.width / 2;
      const x = this.pickLane(road, sampleDistance, half, rng);
      return { kind: "civilian", x };
    }

    const n = this.unlockedEnemyCount(distance);
    // int(min, max) is inclusive on both ends, so [0, n-1] picks one of the n
    // unlocked types.
    const type = PICK_ORDER[rng.int(0, n - 1)];
    const half = this.config.enemies[type].width / 2;
    const x = this.pickLane(road, sampleDistance, half, rng);
    return { kind: "enemy", type, x };
  }

  /** Reset the director for a fresh run (re-seeds set-pieces on next update). */
  reset() {
    const d = this.config.director;
    this.spawnTimer = d.maxInterval;
    for (const name of Object.keys(d.setpieces)) this.nextSetpiece[name] = null;
    this._initialized = false;
  }
}

export default Director;
