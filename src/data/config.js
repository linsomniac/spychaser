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
  }),

  // --- Enemies ---
  enemies: Object.freeze({
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
  }),

  // --- Spawn director ---
  director: Object.freeze({
    initialSpawnInterval: 1.6, // seconds between spawns at start
    minSpawnInterval: 0.45, // floor as difficulty ramps
    rampDuration: 120, // seconds to ramp from initial -> min interval
    maxConcurrent: 8, // cap on simultaneous live enemies
    heavyChanceStart: 0.05,
    heavyChanceMax: 0.35,
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
