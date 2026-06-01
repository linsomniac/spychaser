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
import { createEnemy, Bomb, HELI_PHASE } from "../entities/enemies.js";
import { Civilian } from "../entities/civilian.js";
import {
  collidePairs,
  resolveMissilesVsHelicopter,
  resolveBombBlast,
} from "../systems/collision.js";
import { Director } from "../systems/director.js";

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

    /**
     * The Mad Bomber helicopter set-piece (Phase 7). At most one is live at a
     * time; null when none is on-screen. Spawned by the director's "helicopter"
     * set-piece, immune to bullets, destroyed only by missiles.
     * @type {import("../entities/enemies.js").Helicopter|null}
     */
    this.helicopter = null;
    /**
     * Live bombs dropped by the helicopter. Plain array; spent bombs (blast
     * window elapsed) are filtered out each tick.
     * @type {import("../entities/enemies.js").Bomb[]}
     */
    this.bombs = [];
    /** Total bombs dropped this run (observability for tests/SFX). */
    this._bombsDropped = 0;

    /**
     * Countdown until the next boat-wake splash (Phase 8). Counts down only
     * while in boat mode; reset to the cadence interval on each emission. Kept
     * on the world (not the player) so the splash uses the world RNG and stays
     * deterministic and replay-stable.
     * @type {number}
     */
    this._wakeTimer = 0;

    /** Running score (full scoring/lives loop lands in Phase 10). */
    this.score = 0;
    /** Count of civilians destroyed this run (penalty marker for Phase 10). */
    this.civilianHits = 0;

    /**
     * Seeded spawn director (Phase 5). Replaces the Phase-4 debug spawner. It
     * schedules escalating enemy/civilian traffic and milestone set-pieces; it
     * shares the world RNG (passed in update's context) so the entire run —
     * road + spawns + set-pieces — is reproducible from a single seed.
     * @type {Director}
     */
    this.director = new Director({ config: this.config });
    /**
     * Set-piece triggers fired by the director, drained by higher-level systems
     * in later phases (weapons van, helicopter, water, weather). Each entry is
     * { name, distance }.
     * @type {Array<{name:string, distance:number}>}
     */
    this.setpieces = [];
    /**
     * Optional hook invoked once per set-piece trigger: onSetpiece(trigger, world).
     * Later phases attach to this; null by default.
     * @type {((t:{name:string,distance:number}, world:World)=>void)|null}
     */
    this.onSetpiece = null;

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

    // --- Boat wake splash (Phase 8). ---
    // AIDEV-NOTE: while in boat mode and making way, kick up foam at the stern on
    // a fixed cadence. Pulls from the world RNG so a seed + input reproduces the
    // wake (deterministic), and uses the pooled particle system (no GC churn).
    if (this.player.isBoat && !this.player.crashed && this.player.speed > 20) {
      this._wakeTimer -= dt;
      if (this._wakeTimer <= 0) {
        this._wakeTimer = this.config.boatWake?.interval ?? 0.08;
        const sternY = this.player.y + this.player.height / 2;
        this.particles.splash(this.player.x, sternY, this.rng);
      }
    } else {
      this._wakeTimer = 0;
    }

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

    // --- Spawning: the seeded director (Phase 5) replaces the debug spawner. ---
    // It returns events; _realizeSpawn turns them into enemies/civilians and
    // queued set-piece triggers. The world RNG is shared so runs are seed-exact.
    const spawnEvents = this.director.update(dt, {
      distance: this.distance,
      speed: this.speed,
      road: this.road,
      rng: this.rng,
    });
    for (const ev of spawnEvents) this._realizeSpawn(ev);

    // --- Enemies: behavior + realize their attack events. ---
    for (const e of this.enemies) {
      const events = e.update(dt, this);
      for (const ev of events) this._realizeEnemyEvent(ev);
    }

    // --- Civilians. ---
    for (const c of this.civilians) c.update(dt, this);

    // --- Helicopter set-piece (Phase 7): update + realize bomb drops. ---
    if (this.helicopter) {
      const events = this.helicopter.update(dt, this);
      for (const ev of events) {
        if (ev.type === "bomb") {
          this.bombs.push(new Bomb(ev.x, ev.y, { config: this.config }));
          this._bombsDropped += 1;
        }
      }
    }
    for (const b of this.bombs) b.update(dt);

    // --- Projectiles & particles. ---
    this.projectiles.update(dt);
    this.hostiles.update(dt);
    this.particles.update(dt);

    // --- Collisions (Phase 4 + Phase 7). ---
    this._resolveCollisions();

    // --- Cull dead / off-screen entities. ---
    this.enemies = this.enemies.filter(
      (e) => e.active && !e.dead && !e.isOffscreen(this.height),
    );
    this.civilians = this.civilians.filter(
      (c) => c.active && !c.isOffscreen(this.height),
    );
    // Spent bombs (blast window elapsed) are dropped from the live array.
    this.bombs = this.bombs.filter((b) => b.active);
    // Retire the helicopter once it has flown off the top (LEAVING + above edge).
    if (
      this.helicopter &&
      this.helicopter.phase === HELI_PHASE.LEAVING &&
      this.helicopter.isOffscreen(this.height)
    ) {
      this.helicopter = null;
    }
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

    // --- Phase 7: missiles vs helicopter; bomb blasts vs player. ---
    // Bullets are ignored by the heli (immune); only missiles harm it. On the
    // killing missile hit, explode + score.
    if (this.helicopter && !this.helicopter.dead) {
      const heliHits = resolveMissilesVsHelicopter(
        this.projectiles.toArray(),
        this.helicopter,
      );
      for (const hit of heliHits) {
        this.projectiles.kill(hit.projectile);
        if (this.helicopter.dead) {
          this.particles.explosion(this.helicopter.x, this.helicopter.y, this.rng);
          this.score += this.config.helicopter.scoreValue;
        } else {
          this.particles.hitSpark(hit.projectile.x, hit.projectile.y, this.rng);
        }
      }
    }
    // Detonated bombs blast the player. Each bomb blasts once (blastApplied).
    const blastHits = resolveBombBlast(this.bombs, playerGroup);
    for (const hit of blastHits) {
      hit.target.lastHitBy = "bomb";
      this.particles.explosion(hit.bomb.x, hit.bomb.y, this.rng);
    }
  }

  /**
   * Realize one director event into the world: spawn an enemy/civilian into its
   * live array, or queue a set-piece trigger (consumed by later-phase systems).
   *
   * AIDEV-NOTE: kept in the World (not the director) so the director stays pure
   * logic with no entity/pool dependencies — it only decides WHAT and WHERE; the
   * world decides HOW to instantiate.
   * @param {{kind:string, type?:string, x?:number, name?:string}} ev
   * @private
   */
  _realizeSpawn(ev) {
    if (ev.kind === "enemy") {
      this.enemies.push(createEnemy(ev.type, ev.x, { config: this.config }));
    } else if (ev.kind === "civilian") {
      // Civilian takes (x, targetX); start its drift target at its spawn x.
      this.civilians.push(new Civilian(ev.x, ev.x, { config: this.config }));
    } else if (ev.kind === "setpiece") {
      const trigger = { name: ev.name, distance: this.distance };
      this.setpieces.push(trigger);
      // AIDEV-NOTE: Phase 7 — the "helicopter" milestone spawns the Mad Bomber
      // above the player. One-shot guard: ignore the trigger if a heli is
      // already on-screen so a re-fired milestone never stacks two helis.
      if (ev.name === "helicopter" && !this.helicopter) {
        this.helicopter = createEnemy("helicopter", this.player.x, {
          config: this.config,
        });
      }
      if (this.onSetpiece) this.onSetpiece(trigger, this);
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
    this.helicopter = null;
    this.bombs = [];
    this._bombsDropped = 0;
    this._wakeTimer = 0;
    this.score = 0;
    this.civilianHits = 0;
    this.director.reset();
    this.setpieces = [];
    this.state = "playing";
  }
}

export default World;
