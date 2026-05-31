// core/world.js
//
// The simulation world: the single source of truth for game state. It is kept
// completely decoupled from Canvas and requestAnimationFrame so it can be unit
// tested headlessly. The loop calls `world.update(dt)` with a fixed step; the
// renderer reads from the world but never mutates it.
//
// AIDEV-NOTE: Grown from the Phase 0 stub. Holds the deterministic sim state
// (seeded RNG, tick/time counters, scroll distance) plus the procedural Road,
// the Player, and (Phase 3) the machine gun, pooled projectiles, and particle
// effects. Later phases (enemies, director, scoring) flesh it out.

import { createRng } from "../engine/rng.js";
import { config } from "../data/config.js";
import { Road } from "../systems/road.js";
import { Player } from "../entities/player.js";
import { Projectiles } from "../entities/projectiles.js";
import { MachineGun, fireMachineGun } from "../systems/weapons.js";
import { ParticleSystem } from "../render/effects.js";
import { createEnemy, ENEMY_TYPES } from "../entities/enemies.js";
import { Civilian } from "../entities/civilian.js";
import { collidePairs } from "../systems/collision.js";

/**
 * @typedef {Object} WorldOptions
 * @property {number} [seed]   RNG seed for deterministic runs.
 * @property {typeof config} [config]  Tunables (defaults to data/config.js).
 */

export class World {
  /** @param {WorldOptions} [options] */
  constructor(options = {}) {
    /** @type {typeof config} */
    this.config = options.config ?? config;
    /** seed retained so we can rebuild deterministic subsystems on reset */
    this._seed = options.seed ?? 1;
    /** @type {import("../engine/rng.js").Rng} */
    this.rng = createRng(this._seed);

    /** virtual play-field dimensions, mirrored for convenience */
    this.width = this.config.VIRTUAL_WIDTH;
    this.height = this.config.VIRTUAL_HEIGHT;

    /** seconds of simulated time elapsed */
    this.time = 0;
    /** number of fixed update ticks executed */
    this.ticks = 0;
    /** total virtual px the world has scrolled (proxy for distance) */
    this.distance = 0;
    /**
     * Current scroll speed in virtual px/s. Defaults to the road base speed;
     * the player's throttle adjusts this in a later phase. `distance` advances
     * by `speed * dt` each tick.
     */
    this.speed = this.config.road.baseScrollSpeed;

    /**
     * Procedural road. The Road instance gets its own seed derived from the
     * world seed so road layout is reproducible without entangling its RNG
     * stream with the world's (which the director/spawns will consume).
     * @type {Road}
     */
    this.road = new Road({ seed: this._roadSeed(this._seed), config: this.config });

    /**
     * The player's interceptor. The world feeds it the input snapshot each tick
     * and reads back its forward speed to drive the road scroll.
     * @type {Player}
     */
    this.player = new Player({ config: this.config });

    /**
     * Machine gun + pooled bullets (Phase 3). The gun owns the autofire cadence;
     * the projectile pool owns bullet lifetimes. They are decoupled so the
     * cadence logic stays unit-testable without the pool.
     * @type {MachineGun}
     */
    this.gun = new MachineGun();
    /** @type {Projectiles} player machine-gun rounds. */
    this.projectiles = new Projectiles();
    /**
     * Hostile projectiles (Road Lord bullets + Barrel Dumper barrels), kept in a
     * SEPARATE pool from player bullets so category filtering, rendering and
     * collision stay clean. (Phase 4.)
     * @type {Projectiles}
     */
    this.hostiles = new Projectiles();
    /**
     * Pooled particle effects (muzzle flashes, hit sparks, explosions). Bursts
     * pull from the world RNG so a seed + input sequence reproduces the visuals.
     * @type {ParticleSystem}
     */
    this.particles = new ParticleSystem();

    /**
     * Live ground enemies and civilian traffic (Phase 4). Plain arrays; dead /
     * off-screen entities are filtered out each tick.
     * @type {import("../entities/enemies.js").Enemy[]}
     */
    this.enemies = [];
    /** @type {import("../entities/civilian.js").Civilian[]} */
    this.civilians = [];

    /** Running score (full scoring/lives loop lands in Phase 10). */
    this.score = 0;
    /** Count of civilians destroyed this run (penalty marker for Phase 10). */
    this.civilianHits = 0;

    // AIDEV-TODO(P5): TEMPORARY debug spawner timers. Replaced by systems/
    // director.js in Phase 5. They exist only to exercise every enemy behavior +
    // civilians in-browser during Phase 4.
    this._dbgEnemyTimer = config.director.initialSpawnInterval;
    this._dbgCivilianTimer = 2.0;
    this._dbgEnemyIdx = 0;

    /**
     * Held-action snapshot for the current tick, set by setInput() before
     * update(). Defaults to no input so headless ticks are well-defined.
     * @type {import("../entities/player.js").PlayerInput}
     */
    this.input = {};

    /** simple lifecycle flag; later phases add menu/playing/gameover */
    this.state = "playing";
  }

  /**
   * Provide the held-action snapshot for the next update() tick. The bootstrap
   * (main.js) calls this each frame from engine/input.js; tests can call it to
   * script a deterministic input sequence.
   * @param {import("../entities/player.js").PlayerInput} input
   */
  setInput(input) {
    this.input = input ?? {};
  }

  /**
   * Derive a stable, distinct road seed from the world seed so the road's RNG
   * stream is independent of (but reproducible from) the world seed.
   * @param {number} seed
   * @returns {number}
   * @private
   */
  _roadSeed(seed) {
    // AIDEV-NOTE: XOR with a fixed constant keeps it deterministic while
    // decoupling the road's derived offsets from the world RNG stream.
    return (((seed >>> 0) ^ 0x5193b1c7) >>> 0) || 1;
  }

  /**
   * Advance the simulation by exactly `dt` seconds (the loop's fixed step).
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.state !== "playing") return;
    this.time += dt;
    this.ticks += 1;

    // Drive the player from this tick's input, sampling the road at the car's
    // own row so its off-road/crash checks line up with what is rendered there.
    const playerDistance = this.distance + (this.height - this.player.y);
    this.player.update(dt, this.input, this.road, playerDistance);

    // AIDEV-NOTE: the world scrolls at a base speed plus the player's throttle
    // contribution. Even at zero throttle the road creeps forward so the chase
    // never fully stops; the player's speed adds on top of that base.
    this.speed = this.config.road.baseScrollSpeed + Math.max(0, this.player.speed);
    this.distance += this.speed * dt;

    // --- Weapons: machine gun autofire (hold Space => input.fire). ---
    // The player must be alive to shoot; a crashed car holds its fire.
    const firing = !this.player.crashed && !!this.input.fire;
    const muzzle = fireMachineGun(this.gun, dt, firing, this.player, this.projectiles);
    if (muzzle.spawned > 0) {
      this.particles.muzzleBurst(muzzle.x, muzzle.y, this.rng);
    }

    // --- Spawning (TEMPORARY debug director; replaced in Phase 5). ---
    this._debugSpawn(dt);

    // --- Enemies: behavior + realize their attack events. ---
    for (const e of this.enemies) {
      const events = e.update(dt, this);
      for (const ev of events) this._realizeEnemyEvent(ev);
    }

    // --- Civilians. ---
    for (const c of this.civilians) c.update(dt, this);

    // --- Projectiles & particles. ---
    this.projectiles.update(dt);
    this.hostiles.update(dt);
    this.particles.update(dt);

    // --- Collisions (Phase 4). ---
    this._resolveCollisions();

    // --- Cull dead / off-screen entities. ---
    this.enemies = this.enemies.filter(
      (e) => e.active && !e.dead && !e.isOffscreen(this.height),
    );
    this.civilians = this.civilians.filter(
      (c) => c.active && !c.isOffscreen(this.height),
    );
  }

  /**
   * Realize an enemy attack event into the world (spawn hostiles / apply slash).
   * @param {object} ev
   * @private
   */
  _realizeEnemyEvent(ev) {
    if (ev.type === "enemyBullet") {
      this.hostiles.spawnEnemyBullet(ev.x, ev.y, ev.vx, ev.vy, this.config);
    } else if (ev.type === "barrel") {
      this.hostiles.spawnBarrel(ev.x, ev.y, this.config);
    } else if (ev.type === "slash") {
      // AIDEV-NOTE: the slash is an instantaneous hit on the player. Full
      // damage/lives consequences arrive in Phase 10; for now mark contact so
      // SFX/HUD can react and the behavior is observable.
      this.player.lastHitBy = "switchblade";
    }
  }

  /**
   * Resolve all Phase-4 collisions:
   *   player bullet -> enemy    : damage; on death explosion + score + cull
   *   player bullet -> civilian : penalty marker + remove civilian + bullet
   *   player <-> enemy (ram)    : contact reported (Enforcer rams)
   *   player <-> barrel         : contact; barrel consumed
   *   player <-> civilian       : pass-through (reported, no damage)
   *   enemy bullet -> player    : contact; bullet consumed
   * @private
   */
  _resolveCollisions() {
    const bullets = this.projectiles.toArray();

    // Player bullets vs enemies. One-shot: a bullet that hits stops there.
    collidePairs(
      bullets,
      this.enemies,
      (bullet, enemy) => {
        // AIDEV-NOTE: bulletproof enemies (Enforcer) absorb the round but take
        // no damage. damage() returns true only on a killing blow.
        const died = enemy.damage(bullet.damage);
        if (died) {
          this.particles.explosion(enemy.x, enemy.y, this.rng);
          this.score += enemy.def.scoreValue;
        } else {
          this.particles.hitSpark(bullet.x, bullet.y, this.rng);
        }
        this.projectiles.kill(bullet);
        return true; // consume the bullet
      },
    );

    // Player bullets vs civilians (penalty). Re-read live bullets (some were
    // consumed above). One-shot per bullet.
    collidePairs(
      this.projectiles.toArray(),
      this.civilians,
      (bullet, civ) => {
        civ.active = false; // a shot civilian is removed
        this.civilianHits += 1;
        this.score = Math.max(0, this.score - this.config.civilians.scorePenalty);
        this.particles.explosion(civ.x, civ.y, this.rng);
        this.projectiles.kill(bullet);
        return true;
      },
    );

    // Player vs enemies (ram). Reported via player.lastHitBy; consequences P10.
    const playerGroup = [this.player];
    collidePairs(playerGroup, this.enemies, (player, enemy) => {
      player.lastHitBy = enemy.type;
      // Don't consume the player; allow contact with multiple enemies.
      return false;
    });

    // Player vs barrels + enemy bullets (hostiles pool). Filter by category.
    collidePairs(
      this.hostiles.toArray(),
      playerGroup,
      (hostile, player) => {
        player.lastHitBy = hostile.category;
        this.hostiles.kill(hostile);
        return true; // consume the hostile
      },
    );

    // Player vs civilians (pass-through; reported only, no damage/removal).
    collidePairs(playerGroup, this.civilians, (player, civ) => {
      player.touchingCivilian = true;
      return false;
    });
  }

  /**
   * AIDEV-TODO(P5): TEMPORARY debug spawner. Cycles through every enemy type and
   * drops civilians so all Phase-4 behaviors can be observed in-browser. Replaced
   * by systems/director.js in Phase 5. Spawns within the road body at the top.
   * @param {number} dt
   * @private
   */
  _debugSpawn(dt) {
    const d = this.config.director;
    const sampleTop = this.road.sampleAt(this.distance + this.height);

    this._dbgEnemyTimer -= dt;
    if (this._dbgEnemyTimer <= 0) {
      this._dbgEnemyTimer = d.initialSpawnInterval;
      const type = ENEMY_TYPES[this._dbgEnemyIdx % ENEMY_TYPES.length];
      this._dbgEnemyIdx += 1;
      const half = this.config.enemies[type].width / 2;
      const x = this.rng.range(sampleTop.leftEdge + half, sampleTop.rightEdge - half);
      this.enemies.push(createEnemy(type, x, { config: this.config }));
    }

    this._dbgCivilianTimer -= dt;
    if (this._dbgCivilianTimer <= 0) {
      this._dbgCivilianTimer = this.config.civilians.driftInterval + 0.6;
      const half = this.config.civilians.width / 2;
      const x = this.rng.range(sampleTop.leftEdge + half, sampleTop.rightEdge - half);
      this.civilians.push(new Civilian(x, x, { config: this.config }));
    }
  }

  /**
   * Sample the road at the current scroll distance (or an explicit distance).
   * Pure pass-through to the Road sampler; the renderer and collision use this.
   * @param {number} [distance] defaults to the world's current scroll distance
   * @returns {import("../systems/road.js").RoadSample}
   */
  sampleRoad(distance = this.distance) {
    return this.road.sampleAt(distance);
  }

  /** Current integer sector index at the world's scroll distance. */
  get sector() {
    return this.road.sectorAt(this.distance);
  }

  /**
   * Reset to an initial state. Optionally reseed for a fresh deterministic run.
   * @param {number} [seed]
   */
  reset(seed) {
    if (seed !== undefined) {
      this._seed = seed;
      this.rng = createRng(seed);
      this.road.reset(this._roadSeed(seed));
    }
    this.time = 0;
    this.ticks = 0;
    this.distance = 0;
    this.speed = this.config.road.baseScrollSpeed;
    this.input = {};
    this.player.reset();
    this.gun = new MachineGun();
    this.projectiles.clear();
    this.hostiles.clear();
    this.particles.clear();
    this.enemies = [];
    this.civilians = [];
    this.score = 0;
    this.civilianHits = 0;
    this._dbgEnemyTimer = this.config.director.initialSpawnInterval;
    this._dbgCivilianTimer = 2.0;
    this._dbgEnemyIdx = 0;
    this.state = "playing";
  }
}

export default World;
