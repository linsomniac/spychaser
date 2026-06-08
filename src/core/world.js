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
import {
  MachineGun,
  fireMachineGun,
  consumeSpecial,
  specialEffect,
} from "../systems/weapons.js";
import { createWeaponsVan, updateVanLoad } from "../entities/weaponsVan.js";
import {
  createHazard,
  tickHazard,
  applyHazardToEnemy,
} from "../entities/hazards.js";
import { ParticleSystem } from "../render/effects.js";
import { createEnemy, Bomb, HELI_PHASE } from "../entities/enemies.js";
import { Civilian } from "../entities/civilian.js";
import {
  collidePairs,
  resolveMissilesVsHelicopter,
  resolveBombBlast,
} from "../systems/collision.js";
import { Director } from "../systems/director.js";
import { Weather } from "../systems/weather.js";
import { Scoring } from "../systems/scoring.js";

/**
 * @typedef {Object} WorldOptions
 * @property {number} [seed]   RNG seed for deterministic runs.
 * @property {typeof config} [config]  Tunables (defaults to data/config.js).
 * @property {Storage|null} [storage]  High-score backend for Scoring; defaults
 *   to globalThis.localStorage in the browser, null (no persistence) in tests.
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
     * Live weapons vans (Phase 6 set-piece). Spawned by the director's
     * "weaponsVan" milestone; tucking into a van's rear ramp loads a random
     * special into the player. Plain array; culled when offscreen/spent.
     * @type {import("../entities/weaponsVan.js").WeaponsVan[]}
     */
    this.vans = [];
    /**
     * Deployed field hazards (oil slick / smoke screen) dropped by the player's
     * rear specials. They scroll with the road, age out, and spin/blind enemies.
     * @type {import("../entities/hazards.js").Hazard[]}
     */
    this.hazards = [];
    /**
     * Cooldown gate (seconds) between special-weapon deployments. Counts down in
     * update(); fireSpecial() is a no-op while it is positive.
     * @type {number}
     */
    this._specialCooldown = 0;

    /**
     * Countdown until the next boat-wake splash (Phase 8). Counts down only
     * while in boat mode; reset to the cadence interval on each emission. Kept
     * on the world (not the player) so the splash uses the world RNG and stays
     * deterministic and replay-stable.
     * @type {number}
     */
    this._wakeTimer = 0;

    /**
     * Scoring, lives & the bonus-time mechanic (Phase 10). The world routes all
     * score/lives state through this one instance; `world.score` and
     * `world.civilianHits` are accessors that delegate to it (so existing
     * collision/test code reading/writing those fields keeps working). The high
     * score is loaded from localStorage if available (no-op headless / in tests).
     * @type {Scoring}
     */
    this.scoring = new Scoring({ config: this.config, storage: options.storage });
    this.scoring.loadHighScore();

    /**
     * Distance already credited to the score (px). Each tick the world awards
     * points for the NEW distance only (distance - _scoredDistance). Kept
     * separate from `distance` so distance scoring is monotonic and replay-stable.
     * @type {number}
     */
    this._scoredDistance = 0;

    /**
     * Edge-detect the player's crash so a wreck is registered with Scoring
     * exactly once (the player stays `crashed` for several ticks while coasting
     * to a stop). See _handleCrash.
     * @type {boolean}
     */
    this._wasCrashed = false;

    /**
     * Seeded spawn director (Phase 5). Replaces the Phase-4 debug spawner. It
     * schedules escalating enemy/civilian traffic and milestone set-pieces; it
     * shares the world RNG (passed in update's context) so the entire run —
     * road + spawns + set-pieces — is reproducible from a single seed.
     * @type {Director}
     */
    this.director = new Director({ config: this.config });
    /**
     * Weather state machine (Phase 9). Fog (visibility) and ice (traction)
     * episodes are triggered by the director's "weather" set-piece and clear on
     * their own after a fixed duration. The renderer reads it for the fog
     * vignette; the player reads it for ice steering. It advances on a seconds
     * timer (no RNG) so a triggered episode is replay-stable.
     * @type {Weather}
     */
    this.weather = new Weather({ config: this.config });
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

    /**
     * Per-tick AUDIO-EVENT QUEUE (Phase 12). The sim is canvas/Web-Audio free,
     * so instead of calling SFX directly the World appends plain event tags here
     * during update(); the browser audio bridge (main.js) drains them each frame
     * via drainAudioEvents() and triggers the matching procedural sound. Keeping
     * it a plain data array means the queue is fully unit-testable headlessly and
     * the World never imports audio. Tags: "gun", "explosion", "civilianWarning",
     * "lowCars", "weaponLoad".
     * @type {Array<{type:string}>}
     */
    this.audioEvents = [];

    /** simple lifecycle flag; later phases add menu/playing/gameover */
    this.state = "playing";
  }

  /**
   * Append an audio event tag for the browser audio bridge to drain this frame.
   * No-op-friendly: pure bookkeeping, never touches Web Audio.
   * @param {string} type one of the documented audio-event tags.
   * @private
   */
  _emitAudio(type) {
    this.audioEvents.push({ type });
  }

  /**
   * Drain (return + clear) the queued audio events. Called once per frame by the
   * browser audio bridge; in tests it lets assertions read what fired this tick.
   * @returns {Array<{type:string}>}
   */
  drainAudioEvents() {
    if (this.audioEvents.length === 0) return EMPTY_AUDIO_EVENTS;
    const out = this.audioEvents;
    this.audioEvents = [];
    return out;
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
    if (this._specialCooldown > 0) {
      this._specialCooldown = Math.max(0, this._specialCooldown - dt);
    }

    // --- Weather (Phase 9): advance any active fog/ice episode (timer-only). ---
    // AIDEV-NOTE: updated BEFORE the player so the car reads this tick's ice
    // intensity. The director's "weather" set-piece is what triggers an episode
    // (see _realizeSpawn); here we only age it toward clearing.
    this.weather.update(dt);

    // Drive the player from this tick's input, sampling the road at the car's
    // own row so its off-road/crash checks line up with what is rendered there.
    // The weather is threaded in so an ICE episode makes the steering slippery.
    const playerDistance = this.distance + (this.height - this.player.y);
    this.player.update(dt, this.input, this.road, playerDistance, this.weather);

    // --- Crash -> lives state machine (Phase 10). ---
    // AIDEV-NOTE: detect the rising edge of player.crashed (it latches for the
    // coast-to-stop). On the edge we charge Scoring a car (free during the bonus
    // window, otherwise a spare car); a free / paid-but-survivable wreck respawns
    // the car, an out-of-cars wreck ends the run.
    this._handleCrash();

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

    // --- Scoring (Phase 10): age the bonus-time window + credit new distance. ---
    // AIDEV-NOTE: a driving-wreck this tick is judged in _handleCrash() ABOVE,
    // i.e. against the START-of-tick bonus window; this scoring.update(dt) ages
    // the timer afterward. The effect is at most a single fixed step (~1/60 s) of
    // generosity at the exact expiry boundary (a wreck on the expiry tick still
    // gets the free replacement) — acceptable and simpler than re-ordering the
    // crash check. Then award points for the NEW distance covered THIS tick only
    // (distance - already-scored); distance scoring alone can cross the banking
    // threshold while the window is open.
    this.scoring.update(dt);
    const newDistance = this.distance - this._scoredDistance;
    if (newDistance > 0) {
      this.scoring.addDistance(newDistance);
      this._scoredDistance = this.distance;
    }

    // --- Weapons: machine gun autofire (hold Space => input.fire). ---
    // The player must be alive to shoot; a crashed car holds its fire.
    const firing = !this.player.crashed && !!this.input.fire;
    const muzzle = fireMachineGun(this.gun, dt, firing, this.player, this.projectiles);
    if (muzzle.spawned > 0) {
      this.particles.muzzleBurst(muzzle.x, muzzle.y, this.rng);
      this._emitAudio("gun"); // Phase 12: machine-gun SFX cue
    }

    // --- Spawning: the seeded director (Phase 5) replaces the debug spawner. ---
    // It returns events; _realizeSpawn turns them into enemies/civilians and
    // queued set-piece triggers. The world RNG is shared so runs are seed-exact.
    const spawnEvents = this.director.update(dt, {
      distance: this.distance,
      speed: this.speed,
      road: this.road,
      rng: this.rng,
      liveEnemyCount: this.enemies.length, // ground enemies only; cap lever (§4.2)
    });
    for (const ev of spawnEvents) this._realizeSpawn(ev);

    // --- Enemies: behavior + realize their attack events. ---
    for (const e of this.enemies) {
      const events = e.update(dt, this);
      for (const ev of events) this._realizeEnemyEvent(ev);
    }

    // --- Civilians. ---
    for (const c of this.civilians) c.update(dt, this);

    // --- Weapons van set-piece (Phase 6): drift, load handshake, cull. ---
    // AIDEV-NOTE: the van drives down like traffic; tucking into its rear ramp
    // for van.loadFrames continuous steps loads ONE random special. The handshake
    // (updateVanLoad) is pure + RNG-injected (world RNG) so it stays replay-exact.
    // Delivery — not mere appearance — sounds the weapon-load jingle (spec §8).
    for (const van of this.vans) {
      van.update(dt);
      const loaded = updateVanLoad(van, this.player, this.rng);
      if (loaded) {
        this.player.special = loaded;
        this._emitAudio("weaponLoad");
      }
    }
    this.vans = this.vans.filter((v) => v.active && !v.isOffscreen(this.height));

    // --- Deployed field hazards (Phase 6): scroll with the road, age out, and
    // spin/blind any enemy that drives over them. Uses the live scroll speed so
    // the slick/cloud stays pinned to the asphalt. ---
    for (const h of this.hazards) {
      tickHazard(h, dt, this.speed);
      for (const e of this.enemies) applyHazardToEnemy(h, e);
    }
    this.hazards = this.hazards.filter((h) => h.active);

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

    // --- Persist the high score on the tick the run ends (M3). ---
    // AIDEV-NOTE: _endRun() flips state to "gameover" mid-tick (from _handleCrash,
    // before this tick's distance + kills are credited). Saving here — at the END
    // of the ending tick — captures those final-tick points. Runs exactly once:
    // the next tick returns early at the top of update() (state !== "playing").
    if (this.state === "gameover") this.scoring.saveHighScore();
  }

  /**
   * Deploy the player's loaded special weapon (spec §6, F/Shift). Front specials
   * (missiles) spawn forward-firing projectiles into the player bullet pool;
   * rear specials (oil/smoke) deploy a field hazard behind the car. Consumes one
   * charge and unloads the slot when depleted; honors the special cooldown.
   * @returns {boolean} true iff a special was deployed this call.
   */
  fireSpecial() {
    const special = this.player.special;
    if (!special || !(special.charge > 0) || this._specialCooldown > 0) {
      return false;
    }
    const effect = specialEffect(special, this.player);
    if (effect.type === "projectiles") {
      for (const m of effect.projectiles) {
        this.projectiles.spawn({
          x: m.x,
          y: m.y,
          vx: m.vx,
          vy: m.vy,
          w: m.width,
          h: m.height,
          category: m.category,
          kind: m.kind,
          damage: m.damage,
          ttl: this.config.weapons.bullet.ttl,
        });
      }
    } else if (effect.type === "hazard") {
      this.hazards.push(
        createHazard(effect.hazard, effect.x, effect.y, { config: this.config }),
      );
    }
    consumeSpecial(special);
    if (!(special.charge > 0)) this.player.special = null;
    this._specialCooldown = this.config.weapons.special.cooldown;
    return true;
  }

  /**
   * Crash -> lives state machine (Phase 10). Edge-detect the player's crash and
   * charge Scoring exactly once per wreck (the crashed flag latches for the
   * coast-to-stop, so we only act on the rising edge). A wreck inside the active
   * bonus window — or one that still leaves cars in reserve — respawns the
   * interceptor; running out of cars ends the run.
   * @private
   */
  _handleCrash() {
    const crashed = this.player.crashed;
    if (crashed && !this._wasCrashed) {
      // Rising edge: register the wreck. loseCar() returns false for a FREE
      // replacement (bonus window) and true when a spare car was spent.
      this.scoring.loseCar();
      if (this.scoring.gameOver) {
        this._endRun();
      } else {
        // Survivable wreck (free or paid): drop a wreck explosion and respawn the
        // interceptor at the start position so play continues.
        this.particles.explosion(this.player.x, this.player.y, this.rng);
        this._emitAudio("explosion"); // Phase 12: wreck blast SFX
        // AIDEV-NOTE: Phase 12 — when a wreck leaves the player running on the
        // last spare car, sound the urgent low-cars alarm (spec §8). cars > 0
        // here (gameOver was false), so 1 remaining == "low".
        if (this.scoring.cars <= 1) this._emitAudio("lowCars");
        this.player.reset();
        // Brief post-respawn invulnerability so the fresh car cannot be instantly
        // re-wrecked by a hazard/enemy it respawns on top of (spec §6 hybrid).
        this.player.invuln = this.config.combat.respawnInvuln;
      }
    }
    // After reset(), player.crashed is false again, so the edge flag follows it.
    this._wasCrashed = this.player.crashed;
  }

  /**
   * End the current run: persist the high score and flip into the GAME_OVER
   * lifecycle state. The full state machine / screens land in Phase 11; here we
   * just stop the sim and lock in the score.
   * @private
   */
  _endRun() {
    // AIDEV-NOTE: do NOT persist the high score here. _handleCrash runs before
    // this tick's distance + kills are credited, so saving now would drop the
    // final-tick points (M3). The save happens at the END of update() once all
    // scoring for the ending tick is in.
    this.state = "gameover";
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
      // AIDEV-NOTE: the Switchblade slash is an instantaneous chip hit on the
      // player's tires (spec §6 hybrid model). It accrues toward maxDamage, so a
      // sustained alongside attack eventually wrecks the car. applyDamage() is a
      // no-op while the player has post-respawn i-frames.
      this.player.applyDamage(this.config.combat.slashDamage);
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
    // Clear per-tick contact markers so they reflect THIS tick only (no latch).
    this.player.touchingCivilian = false;
    const bullets = this.projectiles.toArray();

    // Player bullets vs enemies. One-shot: a bullet that hits stops there.
    collidePairs(
      bullets,
      this.enemies,
      (bullet, enemy) => {
        // AIDEV-NOTE: bulletproof enemies (Enforcer) absorb plain bullets, but a
        // MISSILE is a special — spec §6 says the Enforcer can be "hit with a
        // special". Missiles bypass armor via ram() (one hit per missile, same as
        // the heli takes hp missile-hits), while bullets use normal damage().
        const isMissile =
          bullet.category === "playerMissile" || bullet.kind === "missile";
        const died =
          isMissile && enemy.bulletproof
            ? enemy.ram(1)
            : enemy.damage(bullet.damage);
        if (died) {
          this.particles.explosion(enemy.x, enemy.y, this.rng);
          this._emitAudio("explosion"); // Phase 12: enemy-death blast SFX
          // AIDEV-NOTE: route the kill through Scoring so a kill that crosses the
          // bonus threshold can bank spare cars (Phase 10). scoreValue 0 (Enforcer)
          // is a no-op there.
          this.scoring.addKill(enemy.def.scoreValue);
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
        // AIDEV-NOTE: civilianPenalty does BOTH: subtract the penalty (floored at
        // 0) + count the hit AND suspend the bonus (revoking free replacements /
        // banking) per spec §6. Replaces the old inline score math.
        this.scoring.civilianPenalty(this.config.civilians.scorePenalty);
        this.particles.explosion(civ.x, civ.y, this.rng);
        // Phase 12: civilian destroyed -> blast + the harsh "you hit a civilian"
        // warning cue (spec §8).
        this._emitAudio("explosion");
        this._emitAudio("civilianWarning");
        this.projectiles.kill(bullet);
        return true;
      },
    );

    // Player vs enemies (ram, spec §6): MUTUAL. A ram removes ram-tolerance from
    // the enemy — the bulletproof Enforcer's only kill route — and chips the
    // player. A per-enemy cooldown keeps a sustained overlap from draining both
    // every tick. A rammed-to-death enemy explodes + scores (culled by the
    // dead-filter below).
    const playerGroup = [this.player];
    collidePairs(playerGroup, this.enemies, (player, enemy) => {
      if (enemy._ramCd <= 0) {
        enemy._ramCd = this.config.combat.ramInterval;
        const died = enemy.ram(this.config.combat.ramEnemyHp);
        if (died) {
          this.particles.explosion(enemy.x, enemy.y, this.rng);
          this._emitAudio("explosion");
          this.scoring.addKill(enemy.def.scoreValue);
        }
        player.applyDamage(this.config.combat.ramDamage);
      }
      // Don't consume the player; allow contact with multiple enemies.
      return false;
    });

    // Player vs barrels + enemy bullets (hostiles pool). Hybrid lethality: a
    // rolling barrel is catastrophic (instant wreck); an enemy bullet is a chip
    // hit toward maxDamage. Both are consumed on contact.
    collidePairs(
      this.hostiles.toArray(),
      playerGroup,
      (hostile, player) => {
        if (hostile.category === "barrel") player.wreck();
        else player.applyDamage(this.config.combat.bulletDamage);
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
          this._emitAudio("explosion"); // Phase 12: helicopter-death blast SFX
          this.scoring.addKill(this.config.helicopter.scoreValue);
        } else {
          this.particles.hitSpark(hit.projectile.x, hit.projectile.y, this.rng);
        }
      }
    }
    // Detonated bombs blast the player. Each bomb blasts once (blastApplied).
    const blastHits = resolveBombBlast(this.bombs, playerGroup);
    for (const hit of blastHits) {
      hit.target.wreck(); // a bomb blast is catastrophic -> instant wreck
      this.particles.explosion(hit.bomb.x, hit.bomb.y, this.rng);
      this._emitAudio("explosion"); // Phase 12: bomb-blast SFX
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
      // AIDEV-NOTE: Phase 6 — the weapons-van milestone spawns a live van ahead
      // of the player (entering from the top like traffic). Driving into its rear
      // ramp loads a random special; the load jingle (spec §8) fires on actual
      // delivery in update(), not on mere appearance.
      if (ev.name === "weaponsVan") {
        this.vans.push(
          createWeaponsVan(this.player.x, -this.config.van.height, {
            config: this.config,
          }),
        );
      }
      // AIDEV-NOTE: spec §6 "intensifying enemy waves" — the milestone spawns a
      // tight burst of chasers ON TOP of the director's steady traffic. Lanes are
      // drawn from the world RNG via the director's lane picker so the wave stays
      // deterministic/replay-stable.
      if (ev.name === "enemyWave") {
        const half = this.config.enemies.switchblade.width / 2;
        const count = this.config.enemies.wavePack ?? 3;
        for (let k = 0; k < count; k++) {
          const x = this.director.pickLane(this.road, this.distance, half, this.rng);
          this.enemies.push(createEnemy("switchblade", x, { config: this.config }));
        }
      }
      // AIDEV-NOTE: Phase 7 — the "helicopter" milestone spawns the Mad Bomber
      // above the player. One-shot guard: ignore the trigger if a heli is
      // already on-screen so a re-fired milestone never stacks two helis.
      if (ev.name === "helicopter" && !this.helicopter) {
        this.helicopter = createEnemy("helicopter", this.player.x, {
          config: this.config,
        });
      }
      // AIDEV-NOTE: Phase 9 — the "weather" milestone rolls fog vs ice from the
      // world RNG (deterministic) and triggers that episode. Triggering while one
      // is already running simply restarts with the freshly-rolled kind (the
      // Weather machine replaces the active episode and re-runs the fade-in).
      if (ev.name === "weather") {
        const kinds = this.config.weather.kinds;
        const kind = kinds[this.rng.int(0, kinds.length - 1)];
        this.weather.trigger(kind);
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

  // AIDEV-NOTE: `score` and `civilianHits` are accessors over the Scoring system
  // so all existing collision/test code that reads/writes world.score (e.g.
  // `world.score += value`, `world.score = 1000`) keeps working unchanged while
  // the single source of truth lives in world.scoring. Writing world.score sets
  // the underlying score directly (used by tests to stage a value); the scoring
  // EVENTS (addKill/addDistance/civilianPenalty) are what drive banking/bonus.

  /** Running score for the current run. */
  get score() {
    return this.scoring.score;
  }

  set score(v) {
    this.scoring.score = v;
  }

  /** Civilians destroyed this run. */
  get civilianHits() {
    return this.scoring.civilianHits;
  }

  set civilianHits(v) {
    this.scoring.civilianHits = v;
  }

  /** Persisted/in-memory high score (from localStorage when available). */
  get hiScore() {
    return this.scoring.hiScore;
  }

  /** Spare cars remaining (the bonus-time spare-car mechanic). */
  get cars() {
    return this.scoring.cars;
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
    this.vans = [];
    this.hazards = [];
    this._specialCooldown = 0;
    this.player.special = null;
    this._wakeTimer = 0;
    // AIDEV-NOTE: reset() restores a fresh run's score/lives/bonus state but KEEPS
    // the loaded high score (scoring.reset() preserves hiScore).
    this.scoring.reset();
    this._scoredDistance = 0;
    this._wasCrashed = false;
    this.director.reset();
    this.weather.clear();
    this.setpieces = [];
    this.audioEvents = [];
    this.state = "playing";
  }
}

/** Shared empty result so drainAudioEvents() allocates nothing on an idle tick. */
const EMPTY_AUDIO_EVENTS = Object.freeze([]);

export default World;
