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
    // AIDEV-NOTE: Boathouse markers (Phase 8). A short band of length
    // `boathouseLength` sits at each end of a water stretch: the player drives
    // THROUGH the entry boathouse (car -> boat) on the way in and the exit
    // boathouse (boat -> car) on the way out. The marker bands are carved out of
    // the water stretch interior (the open-water channel is waterLength minus the
    // two boathouse bands), so a stretch with two boathouses still leaves open
    // water in the middle. Keep boathouseLength * 2 < waterLength.
    boathouseLength: 220, // px depth of each boathouse transition band
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

  // --- Enemy combat damage to the player (Phase 10 completion, HYBRID model) ---
  // AIDEV-NOTE: hybrid lethality (see project memory "enemy-damage-model").
  // Catastrophic hits (bomb blast, rolling barrel, leaving the field) instantly
  // wreck the car; chip hits (Switchblade slash, Road Lord bullets, rams) accrue
  // toward player.maxDamage (100). Ramming is MUTUAL — it also removes ram
  // tolerance from the enemy, which is the bulletproof Enforcer's spec kill
  // route. A short post-respawn invulnerability prevents chain-death from
  // clustered hazards. Applied in core/world.js collision resolution.
  combat: Object.freeze({
    slashDamage: 24, // chip per Switchblade tire-slash hit
    bulletDamage: 16, // chip per Road Lord bullet that hits the player
    ramDamage: 30, // chip to the player per ram contact
    ramEnemyHp: 1, // ram tolerance removed from the rammed enemy per contact
    ramInterval: 0.5, // min seconds between successive ram hits (per enemy)
    respawnInvuln: 1.5, // seconds of i-frames after a respawn
  }),

  // --- Boat mode (Phase 8, spec §6 "Water sections") ---
  // AIDEV-NOTE: On water the player swaps to a boat (entities/boat.js). The boat
  // shares the lateral position and forward speed of the car across the handoff
  // (no teleport) but handles differently: slidier steering (lower `grip` =>
  // momentum-carrying lateral drift via boatTraction), a slightly lower top
  // speed, and NO grass-shoulder damage (the banks are water, not verge). The
  // car<->boat transition fires at the boathouse markers carved into the water
  // stretch by systems/road.js. Leaving the water channel entirely is still a
  // crash, handled in entities/player.js.
  boat: Object.freeze({
    width: 40,
    height: 70,
    maxSpeed: 360, // boats top out a bit slower than the interceptor
    minSpeed: -90,
    accel: 460, // virtual px/s^2
    brake: 620,
    coastDecel: 220,
    steerSpeed: 320, // target lateral speed at full steer, virtual px/s
    // Slidier than the car (config.player.grip is 8.0): water carries momentum,
    // so the lateral velocity eases toward the steer target slowly.
    grip: 3.2,
  }),

  // --- Boat wake (Phase 8 splash particles) ---
  // AIDEV-NOTE: cadence (seconds) of the stern-foam splash while the boat makes
  // way. Emitted by core/world.js from the world RNG so it stays deterministic.
  boatWake: Object.freeze({
    interval: 0.08, // seconds between wake splash bursts
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
      // AIDEV-NOTE: only `cooldown` is live — core/world.js reads it to gate
      // consecutive special deployments. The former startCharges/radius/damage
      // fields were a pre-arsenal design that the per-kind `specials.*` blocks
      // below superseded; they were removed as dead config.
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
    wavePack: 3, // chasers spawned by an "enemyWave" set-piece (spec §6)

    // AIDEV-NOTE: soft separation (spec §4.3). A pure-geometry per-tick pass
    // (entities/enemies.js separateEnemies) nudges enemies apart when their
    // bodies overlap, so they never sit directly stacked — flanking side-by-side
    // is still allowed. `push` is the px/s separation speed (split between the
    // pair); margins add a little slack to the overlap test. No RNG.
    separation: Object.freeze({ push: 80, marginX: 6, marginY: 8 }),

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
      ramHp: 3, // ram-tolerance: rammed off the road after this many hits
      approachSpeed: 60,
      steerSpeed: 120,
      scoreValue: 200, // awarded when finally rammed off the road
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

  // --- Mad Bomber helicopter (Phase 7, spec §6 "Enemies") ---
  // AIDEV-NOTE: The heli is an aerial set-piece, NOT road traffic. It is IMMUNE
  // to machine-gun bullets and killable ONLY by missiles (spec §6: "destroyable
  // only by missiles"). It enters from the top, descends to a hover line, tracks
  // the player's x while dropping bombs on a cadence, then flies off the top once
  // defeated. Logic lives in entities/enemies.js (Helicopter); the missile-only
  // rule lives in systems/collision.js. +y is DOWN (renderer convention).
  helicopter: Object.freeze({
    width: 70,
    height: 52,
    hp: 3, // missile HITS required to destroy it (each missile = 1 hit; see collision.js)
    entrySpeed: 130, // px/s descending while ENTERING
    hoverY: 130, // y it settles at once TRACKING, virtual px
    trackSpeed: 120, // px/s lateral chase of the player's x while TRACKING
    trackDeadzone: 6, // px; don't jitter when this close to the player's x
    bombInterval: 1.4, // seconds between bomb drops while TRACKING
    leaveSpeed: 300, // px/s upward once defeated OR waited out (LEAVING) — was 220
    scoreValue: 1000, // points for destroying it (missile kill only)
    // AIDEV-NOTE: lifecycle (spec §4.4). A heli that is neither destroyed nor
    // missiled away still LEAVES on its own after trackDuration seconds of
    // tracking (the player can "wait it out"); it leaves ALIVE so it scores zero.
    // After ANY heli is retired the world enforces a `cooldown`-second break
    // before the next "helicopter" milestone may spawn one (core/world.js
    // _heliCooldown), so they never feel relentless / stacked.
    trackDuration: 16, // seconds of TRACKING before the heli gives up and leaves
    cooldown: 40, // enforced quiet break (seconds) after a heli is retired
    ricochetInterval: 0.12, // min seconds between heli bullet-ricochet cues (spec §4.6)
  }),

  // --- Bombs dropped by the helicopter (Phase 7) ---
  // AIDEV-NOTE: A bomb falls straight down, detonates at road level (detonateY),
  // then exposes a circular blast for blastDuration seconds during which the
  // collision pass can damage the player. Each bomb blasts at most once.
  bomb: Object.freeze({
    width: 16,
    height: 16,
    fallSpeed: 240, // px/s downward
    detonateY: 0.82, // fraction of VIRTUAL_HEIGHT at which the bomb detonates
    blastRadius: 72, // px; circular blast applied on detonation
    blastDuration: 0.35, // seconds the blast stays active
    damage: 1, // damage applied to the player on blast
    ttl: 6, // safety despawn, seconds
  }),

  // --- Spawn director (Phase 5) ---
  // AIDEV-NOTE: The director schedules escalating traffic + milestone set-pieces,
  // all driven by the seeded world RNG so a seed reproduces the whole schedule.
  // Spawn cadence shrinks (gets denser) as scroll `distance` ramps from 0 toward
  // rampDistance. See systems/director.js.
  director: Object.freeze({
    // Cadence: seconds between spawn DECISIONS. Lerps from maxInterval (distance
    // 0) toward minInterval (at/after rampDistance) — difficulty escalation.
    maxInterval: 2.4, // slowest cadence, at the start of a run
    minInterval: 1.0, // fastest cadence, deep into a run
    // AIDEV-NOTE: ramp tuned to 34000 (2026-06 gameplay-fixes pass) so the
    // cadence escalation and the helicopter milestone (firstAt 20000) are reached
    // within a normal run — full difficulty lands ~50 s at full throttle, just
    // inside the 60 s bonus window. The concurrent-enemy cap (maxConcurrentEnemies)
    // is the primary density lever; this ramp shapes cadence/civilian mix.
    rampDistance: 34000, // virtual px over which cadence ramps max -> min
    warmupDistance: 1600, // no enemies until the player has driven this far

    // Per spawn decision: probability the vehicle is a civilian (vs an enemy).
    // Civilian share shrinks with distance (more enemies later in the run).
    civilianChanceStart: 0.55,
    civilianChanceEnd: 0.22,

    // Tougher enemy types unlock by distance. `count` indexes the director's
    // easiest-first PICK_ORDER (switchblade, roadLord, barrelDumper, enforcer);
    // see systems/director.js. Each stage gives how many leading types may spawn.
    enemyUnlock: [
      { distance: 0, count: 1 }, // Switchblade only
      { distance: 6000, count: 2 }, // + Road Lord
      { distance: 16000, count: 3 }, // + Barrel Dumper
      { distance: 30000, count: 4 }, // + Enforcer (hardest)
    ],

    // AIDEV-NOTE: Concurrent-enemy cap (spec §4.2) — the PRIMARY density lever.
    // The live ENEMY count (civilians excluded) may not exceed
    // round(lerp(start, end, difficulty)). When at/over the cap the director
    // skips the whole spawn decision and draws NO RNG (see systems/director.js),
    // so the seeded stream stays stable. Tune start/end here only.
    maxConcurrentEnemies: Object.freeze({ start: 3, end: 6 }),

    // Lateral spawn spread as a fraction of the road half-width around center.
    laneSpread: 0.62,

    // Set-pieces fire at distance milestones, each on its own spacing so they
    // don't all stack. firstAt = first trigger distance; spacing = distance
    // between repeats; jitter = seeded +/- distance wobble. Names are realized by
    // core/world.js _realizeSpawn (weaponsVan / enemyWave / helicopter / weather).
    // AIDEV-NOTE: water is intentionally NOT a director set-piece — water
    // stretches are emitted deterministically by the road sampler (see the
    // road.water* tunables above), so there is no "water" milestone to realize.
    setpieces: Object.freeze({
      weaponsVan: Object.freeze({ firstAt: 3000, spacing: 9000, jitter: 1200 }),
      enemyWave: Object.freeze({ firstAt: 6000, spacing: 14000, jitter: 1500 }),
      weather: Object.freeze({ firstAt: 9000, spacing: 18000, jitter: 2000 }),
      helicopter: Object.freeze({ firstAt: 20000, spacing: 22000, jitter: 2500 }),
    }),
  }),

  // --- Weather set-pieces (Phase 9, spec §6 "Weather set-pieces") ---
  // AIDEV-NOTE: Two weather episodes, triggered + cleared by the director's
  // "weather" set-piece. FOG reduces draw distance / adds a vignette (purely
  // visual: renderer reads weather.fog). ICE reduces traction so the car's
  // steering becomes slippery — instead of the car's normal instantaneous
  // lateral move, the steer input drives a momentum-carrying lateral velocity
  // eased at `iceGrip` (much lower than config.player.grip), exactly the same
  // slidy model the boat uses on water. The traction math (iceTraction) is pure
  // and unit-tested in test/weather.test.js. All durations are in seconds;
  // weather decays/clears deterministically by timer so it never entangles RNG.
  weather: Object.freeze({
    // The kinds the director's weather set-piece can roll between (deterministic
    // via the world RNG when realized). Keep names stable: renderer/player read
    // them by string.
    kinds: ["fog", "ice"],

    fog: Object.freeze({
      duration: 12.0, // seconds the fog episode lasts before clearing
      fadeIn: 1.2, // seconds to ramp visibility down to full fog
      fadeOut: 1.6, // seconds to ramp visibility back to clear when ending
      // Visibility floor at full fog: fraction of the play-field height that
      // stays clearly visible from the bottom (the car's row). 0.42 => roughly
      // the lower 42% of the screen is clear, the top fades to fog.
      visibleFraction: 0.42,
      // Peak opacity of the fog vignette overlay at full intensity (0..1).
      maxOpacity: 0.92,
      color: "#aeb6c2", // flat grey-blue fog (renderer overlay tint)
    }),

    ice: Object.freeze({
      duration: 10.0, // seconds the ice episode lasts before clearing
      fadeIn: 1.0, // seconds to ramp traction down to slidiest
      fadeOut: 1.4, // seconds to ramp grip back to normal when ending
      // AIDEV-NOTE: traction at FULL ice intensity. iceTraction(intensity)
      // lerps the car's effective lateral grip from config.player.grip (no ice,
      // intensity 0) down toward player.grip * minGripFactor (full ice,
      // intensity 1). minGripFactor < 1 => slidier. 0.18 is very slippery while
      // still controllable.
      minGripFactor: 0.18,
      tint: "#cfe8ff", // pale blue sheen drawn over the road on ice
      tintOpacity: 0.16, // overlay opacity for the ice sheen
    }),
  }),

  // --- Scoring, lives & the bonus-time mechanic (Phase 10, spec §6) ---
  // AIDEV-NOTE: The classic Spy Hunter loop. A run opens with a BONUS-TIME window
  // (`bonusWindow` s) during which wrecked cars are replaced for FREE. Crossing
  // `bonusThreshold` points BEFORE that window closes BANKS `bonusSpareCars` spare
  // cars (once). After the window closes, each wreck costs a car; the game ends at
  // zero. Harming a civilian SUSPENDS the bonus (revokes free replacements +
  // blocks banking) on top of the `civilians.scorePenalty` point hit. These
  // tunables drive systems/scoring.js (pure logic; unit-tested test/scoring.test.js).
  scoring: Object.freeze({
    // AIDEV-NOTE: Phase 13 playtest tune. Raised 0.02 -> 0.05 so the steady
    // distance drip keeps the score visibly ticking and makes the in-window
    // banking threshold (bonusThreshold) reachable through play without
    // trivializing it (~20k px of survival nets ~1000 pts of distance score).
    distanceScorePerPx: 0.05, // points awarded per virtual px traveled

    // --- Bonus-time / spare-car mechanic ---
    startCars: 3, // spare cars in reserve at the start of a run
    bonusWindow: 60, // seconds the free-replacement window stays open
    bonusThreshold: 10000, // points that, crossed in-window, bank spare cars
    bonusSpareCars: 3, // spare cars banked when the threshold is crossed
  }),
});

export default config;
