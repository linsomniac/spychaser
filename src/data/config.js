// data/config.js
//
// Central gameplay tunables. Pure data, no behavior. Grouped by subsystem so
// later phases (road, weapons, director, scoring, traction) can pull their
// constants from one place instead of scattering magic numbers.
//
// AIDEV-NOTE: VIRTUAL_WIDTH/HEIGHT define the design-space resolution. Every
// simulation coordinate is in this virtual space; engine/canvas.js maps it to
// real device pixels with letterboxing. Do not bake screen pixels into sim code.

export const config = Object.freeze({
  // --- Virtual play field (design resolution) ---
  VIRTUAL_WIDTH: 540,
  VIRTUAL_HEIGHT: 720,

  // --- Loop timing ---
  FIXED_STEP: 1 / 60, // simulation step, seconds
  MAX_FRAME_TIME: 0.25, // clamp on real elapsed time per frame, seconds

  // --- Road ---
  road: Object.freeze({
    baseScrollSpeed: 260, // virtual px/s the world scrolls at base speed
    laneCount: 4,
    shoulderWidth: 56, // off-road verge width on each side, virtual px
    markerDashLength: 36,
    markerGapLength: 28,
    // Curviness of the procedurally generated road centerline.
    curveAmplitude: 70, // max horizontal offset of centerline, virtual px
    curveFrequency: 0.0016, // spatial frequency of the curve sine, per px
    // AIDEV-NOTE: road body width oscillates between these bounds (must leave
    // room for two shoulders inside VIRTUAL_WIDTH: minWidth/2 + shoulderWidth
    // plus the max curve offset must fit). 70 (curve) + 180 (half of 360) + 56
    // (shoulder) = 306 <= 270? No — so the road sampler clamps the centerX so
    // the road+shoulders always fit; see systems/road.js.
    minWidth: 240, // narrowest road body, virtual px
    maxWidth: 360, // widest road body, virtual px
    widthFrequency: 0.0009, // spatial frequency of the width sine, per px
    // Sectors are fixed-length distance bands; the sector counter advances by
    // one each time the player travels this far.
    sectorLength: 4000, // virtual px per sector
    // Water sections: deterministic stretches of water (boat mode in a later
    // phase). Each "cell" of waterPeriod px has a contiguous water stretch of
    // waterLength px near its end if the seeded roll for that cell passes.
    waterPeriod: 16000, // px between potential water windows
    waterLength: 2600, // px length of a water stretch when present
    waterChance: 0.6, // probability a given period contains water
  }),

  // --- Player car ---
  player: Object.freeze({
    width: 36,
    height: 64,
    startLives: 3,
    maxSpeed: 420, // top forward speed relative to road, virtual px/s
    minSpeed: -120, // braking/reverse
    accel: 520, // forward acceleration, virtual px/s^2
    brake: 760, // braking deceleration, virtual px/s^2
    steerSpeed: 360, // lateral speed, virtual px/s
    // Traction: how quickly lateral velocity decays toward the input target.
    // Lower = slidier. See traction module (later phase).
    grip: 8.0,
    fireCooldown: 0.16, // seconds between primary shots
    // Coasting (no accel/brake) bleeds speed toward zero at this rate so the
    // car settles instead of drifting forever. Virtual px/s^2.
    coastDecel: 320,
    // --- Vertical screen position ---
    // The car sits low on the screen; accelerating nudges it up, braking pulls
    // it back down. These are fractions of VIRTUAL_HEIGHT (0 = top, 1 = bottom).
    restY: 0.78, // resting vertical position (idle speed)
    minY: 0.55, // highest the car climbs at full throttle
    maxY: 0.86, // lowest it falls to while braking
    yLerp: 3.0, // how fast the car eases toward its target y (per second)
    // --- Off-road shoulder penalty (spec §6: slow + damage) ---
    // AIDEV-NOTE: on the grass verge the car is capped to this speed and takes
    // damage over time; running entirely off the play field is a crash. These
    // drive entities/player.js surface handling and its tests.
    offRoadMaxSpeed: 150, // hard speed cap while on a shoulder, virtual px/s
    offRoadDrag: 900, // extra deceleration applied above the cap, px/s^2
    offRoadDamagePerSec: 18, // damage accrued per second on the shoulder
    maxDamage: 100, // damage at which the car is wrecked
  }),

  // --- Weapons ---
  weapons: Object.freeze({
    bullet: Object.freeze({
      speed: 760, // virtual px/s
      width: 6,
      height: 16,
      damage: 1,
      ttl: 1.4, // seconds before despawn
    }),
    special: Object.freeze({
      // F or Shift. Big effect, limited charges.
      startCharges: 2,
      radius: 220, // blast radius, virtual px
      damage: 10,
      cooldown: 0.6, // seconds between specials
    }),

    // --- Special weapons arsenal (Phase 6, spec §6) ---
    // AIDEV-NOTE: A special is loaded from the weapons van and consumed on use.
    // `kinds` is the loadable pool the van draws from (deterministic via RNG).
    // `slot` decides which trigger context fires it: missiles fire FORWARD (the
    // primary special, F/Shift while no rear-specific binding), oil/smoke deploy
    // to the REAR. `charge` is how many times it can be used before depletion.
    specials: Object.freeze({
      kinds: ["missiles", "oil", "smoke"],
      missiles: Object.freeze({
        slot: "front",
        charge: 3,
        speed: 760, // virtual px/s, travels UP (vy < 0)
        width: 8,
        height: 20,
        damage: 5, // enough to kill tough enemies / the helicopter (Phase 7)
        spreadX: 0.6, // twin missiles flank the nose by this fraction of half-w
      }),
      oil: Object.freeze({
        slot: "rear",
        charge: 2,
        width: 56,
        height: 56,
        life: 6.0, // seconds the slick persists on the road
        spinDuration: 2.0, // seconds a pursuer spins out after touching it
      }),
      smoke: Object.freeze({
        slot: "rear",
        charge: 2,
        width: 90,
        height: 90,
        life: 4.2, // seconds the cloud persists
        blindDuration: 2.5, // seconds a pursuer is blinded after touching it
      }),
    }),
  }),

  // --- Weapons van set-piece (Phase 6) ---
  // AIDEV-NOTE: The van drives ahead of the player; tucking into its open rear
  // ramp for `loadFrames` continuous steps loads ONE random special. Geometry is
  // in virtual px; rampZone is a band at the van's rear (bottom, since +y down).
  van: Object.freeze({
    width: 64,
    height: 104,
    approachSpeed: 90, // downward screen velocity, virtual px/s (like enemies)
    loadFrames: 30, // continuous steps tucked in the ramp to load a special
    rampInset: 8, // horizontal inset of the catch zone from the van sides
    rampHeight: 30, // vertical depth of the rear ramp catch band
  }),

  // --- Enemies ---
  // AIDEV-NOTE: Phase 4 cast. Coordinate convention matches the renderer: +y is
  // DOWN. Enemies enter from the top (spawnY < 0) and drive DOWN slower than the
  // road scroll, so relative to the player they hang near the top and fall back.
  // `approachSpeed` is their downward screen velocity (virtual px/s). They steer
  // laterally toward the player's x at `steerSpeed`. Bulletproof enemies ignore
  // bullet damage (Enforcer). `scoreValue` 0 means "no kill points" (Enforcer
  // can't be shot dead).
  enemies: Object.freeze({
    spawnY: -70, // spawn just above the top edge, virtual px

    standard: Object.freeze({
      width: 36,
      height: 64,
      hp: 1,
      speed: 180, // closing/relative speed, virtual px/s
      scoreValue: 100,
    }),
    heavy: Object.freeze({
      width: 44,
      height: 72,
      hp: 4,
      speed: 120,
      scoreValue: 300,
      fireCooldown: 1.2,
    }),

    // Switchblade: pulls alongside the player and slashes its tires.
    switchblade: Object.freeze({
      width: 36,
      height: 64,
      hp: 2,
      approachSpeed: 90,
      steerSpeed: 150, // lateral speed when matching the player's x
      slashRangeX: 48, // lateral range within which the slash connects
      slashRangeY: 84, // vertical band within which the slash connects
      slashCooldown: 0.9,
      scoreValue: 150,
    }),
    // Enforcer: bulletproof heavy car; must be rammed off the road.
    enforcer: Object.freeze({
      width: 46,
      height: 74,
      hp: Infinity, // bullets do nothing
      bulletproof: true,
      approachSpeed: 60,
      steerSpeed: 120,
      scoreValue: 0, // cannot be killed by guns -> no kill points
    }),
    // Road Lord: armed car that returns fire.
    roadLord: Object.freeze({
      width: 38,
      height: 66,
      hp: 3,
      approachSpeed: 70,
      steerSpeed: 90,
      fireCooldown: 1.1,
      bulletSpeed: 360, // downward (+y)
      scoreValue: 250,
    }),
    // Barrel Dumper: truck that drops rolling barrels.
    barrelDumper: Object.freeze({
      width: 48,
      height: 80,
      hp: 2,
      approachSpeed: 50,
      steerSpeed: 60,
      dropCooldown: 1.4,
      scoreValue: 200,
    }),
  }),

  // --- Enemy projectiles / rolling barrels (pooled, extend projectiles.js) ---
  // AIDEV-NOTE: Enemy bullets travel DOWN (vy > 0). Barrels start slow and
  // accelerate downward toward the player (ay > 0) and use circular collision
  // (radius), unlike the rectangular bullets.
  hostiles: Object.freeze({
    enemyBullet: Object.freeze({
      width: 6,
      height: 16,
      damage: 1,
      ttl: 3,
    }),
    barrel: Object.freeze({
      radius: 13,
      initialSpeed: 70, // downward, virtual px/s
      accel: 220, // downward acceleration, virtual px/s^2
      damage: 1,
      ttl: 6,
    }),
  }),

  // --- Civilians (neutral, pass-through traffic) ---
  // AIDEV-NOTE: Civilians must NOT be destroyed; shooting one is penalized and
  // suspends the bonus (full lives logic lands in Phase 10). They cruise slower
  // than the road so they fall behind, with a gentle lane drift for life.
  civilians: Object.freeze({
    width: 36,
    height: 64,
    spawnY: -70,
    approachSpeed: 80,
    driftSpeed: 26, // lateral drift toward a wandering target
    driftInterval: 1.8, // seconds between drift-target re-rolls
    scorePenalty: 300, // points lost for destroying a civilian
  }),

  // --- Explosions (visual; lifetime-only logic) ---
  explosions: Object.freeze({
    ttl: 0.5,
    maxRadius: 44,
    capacity: 16,
  }),

  // --- Spawn director (Phase 5) ---
  // AIDEV-NOTE: The director schedules escalating traffic + milestone set-pieces,
  // all driven by the seeded world RNG so a seed reproduces the whole schedule.
  // Spawn cadence shrinks (gets denser) as scroll `distance` ramps from 0 toward
  // rampDistance. See systems/director.js.
  director: Object.freeze({
    // Retained from Phase 4 (debug spawner is gone, but other code may read it).
    initialSpawnInterval: 1.6, // seconds between spawns at start

    // Cadence: seconds between spawn DECISIONS. Lerps from maxInterval (distance
    // 0) toward minInterval (at/after rampDistance) — difficulty escalation.
    maxInterval: 2.4, // slowest cadence, at the start of a run
    minInterval: 0.65, // fastest cadence, deep into a run
    rampDistance: 60000, // virtual px over which cadence ramps max -> min
    warmupDistance: 700, // no enemies until the player has driven this far

    // Per spawn decision: probability the vehicle is a civilian (vs an enemy).
    // Civilian share shrinks with distance (more enemies later in the run).
    civilianChanceStart: 0.45,
    civilianChanceEnd: 0.22,

    // Tougher enemy types unlock by distance. `count` indexes the director's
    // easiest-first PICK_ORDER (switchblade, roadLord, barrelDumper, enforcer);
    // see systems/director.js. Each stage gives how many leading types may spawn.
    enemyUnlock: [
      { distance: 0, count: 1 }, // Switchblade only
      { distance: 5000, count: 2 }, // + Road Lord
      { distance: 14000, count: 3 }, // + Barrel Dumper
      { distance: 26000, count: 4 }, // + Enforcer (hardest)
    ],

    // Lateral spawn spread as a fraction of the road half-width around center.
    laneSpread: 0.62,

    // Set-pieces fire at distance milestones, each on its own spacing so they
    // don't all stack. firstAt = first trigger distance; spacing = distance
    // between repeats; jitter = seeded +/- distance wobble. Names are consumed by
    // later phases (van/heli/water/weather).
    setpieces: Object.freeze({
      weaponsVan: Object.freeze({ firstAt: 3000, spacing: 9000, jitter: 1200 }),
      enemyWave: Object.freeze({ firstAt: 6000, spacing: 11000, jitter: 1500 }),
      water: Object.freeze({ firstAt: 15000, spacing: 26000, jitter: 2000 }),
      weather: Object.freeze({ firstAt: 9000, spacing: 18000, jitter: 2000 }),
      helicopter: Object.freeze({ firstAt: 20000, spacing: 22000, jitter: 2500 }),
    }),
  }),

  // --- Scoring ---
  scoring: Object.freeze({
    distanceScorePerPx: 0.02, // points awarded per virtual px traveled
    comboWindow: 2.5, // seconds to chain kills for a combo
    comboMultiplierStep: 0.25, // each chained kill adds this to the multiplier
    comboMaxMultiplier: 5.0,
  }),

  // --- Pickups ---
  pickups: Object.freeze({
    spawnInterval: 12, // seconds between pickup spawns
    despawnTtl: 9, // seconds a pickup lingers on the road
  }),
});

export default config;
