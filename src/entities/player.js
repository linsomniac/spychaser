// entities/player.js
//
// The player's interceptor. Arcade handling (spec §6 "Player"):
//   * Steering moves the car laterally and clamps it inside the play field.
//   * Accelerate/brake set the forward speed (which drives world scroll) and
//     nudge the car's vertical screen position (up when fast, down when slow).
//   * Driving onto the grass shoulder slows the car and damages it over time.
//   * Leaving the play field entirely is a crash.
//
// AIDEV-NOTE: All handling math is PURE and decoupled from canvas/raf — the core
// helpers (applyThrottle, clampLateral, surfaceAt) are exported and unit-tested
// in test/player.test.js. `update(dt, input, road, distance)` is fully
// deterministic: given the same inputs and road it always produces the same
// state, which the headless tests rely on. Drawing lives in draw(ctx) via the
// shared render/shapes.js helpers and is the only canvas-touching part.

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { drawVehicle } from "../render/shapes.js";
import { Boat, MODE_CAR, MODE_BOAT, modeForRoad } from "./boat.js";

/** Surface the car is currently sitting on (returned by surfaceAt). */
export const SURFACE_ROAD = "road";
export const SURFACE_SHOULDER = "shoulder";
export const SURFACE_OFFFIELD = "offfield";

/**
 * @typedef {Object} PlayerInput
 * @property {boolean} [left]
 * @property {boolean} [right]
 * @property {boolean} [accel]
 * @property {boolean} [brake]
 */

/**
 * Apply throttle/brake to a forward speed for one step. Pure: returns the new
 * speed, clamped to [minSpeed, maxSpeed].
 *
 *   accel held  -> accelerate at `accel` px/s^2 toward maxSpeed
 *   brake held  -> decelerate at `brake` px/s^2 toward minSpeed
 *   neither     -> coast toward 0 at `coastDecel` px/s^2 (never crossing 0)
 *
 * AIDEV-NOTE: accel takes precedence if both are held (drag-stryle: gun it).
 * Coasting is symmetric toward zero so the car settles rather than reversing.
 *
 * @param {number} speed current forward speed, virtual px/s
 * @param {PlayerInput} input
 * @param {typeof config.player} p player tunables
 * @param {number} dt seconds
 * @returns {number} new speed
 */
export function applyThrottle(speed, input, p, dt) {
  let v = speed;
  if (input.accel) {
    v += p.accel * dt;
  } else if (input.brake) {
    v -= p.brake * dt;
  } else {
    // Coast toward zero without overshooting past it.
    const decel = p.coastDecel * dt;
    if (v > 0) v = Math.max(0, v - decel);
    else if (v < 0) v = Math.min(0, v + decel);
  }
  if (v > p.maxSpeed) v = p.maxSpeed;
  else if (v < p.minSpeed) v = p.minSpeed;
  return v;
}

/**
 * Clamp the car's lateral center so its full body stays inside the play field.
 * Pure helper used both by the player and the steering tests.
 *
 * @param {number} x       proposed center x, virtual px
 * @param {number} width   car body width, virtual px
 * @param {number} fieldW  play-field width, virtual px
 * @returns {number} clamped center x
 */
export function clampLateral(x, width, fieldW) {
  const half = width / 2;
  if (x < half) return half;
  if (x > fieldW - half) return fieldW - half;
  return x;
}

/**
 * Classify the surface under a given lateral position for a road sample.
 *   * within the asphalt body            -> SURFACE_ROAD
 *   * on either grass verge (shoulder)   -> SURFACE_SHOULDER
 *   * beyond the verge (off the field)   -> SURFACE_OFFFIELD
 *
 * Pure: depends only on x and the road sample.
 *
 * @param {number} x center x, virtual px
 * @param {import("../systems/road.js").RoadSample} sample
 * @returns {typeof SURFACE_ROAD | typeof SURFACE_SHOULDER | typeof SURFACE_OFFFIELD}
 */
export function surfaceAt(x, sample) {
  if (x >= sample.leftEdge && x <= sample.rightEdge) return SURFACE_ROAD;
  const outerLeft = sample.leftEdge - sample.shoulderWidth;
  const outerRight = sample.rightEdge + sample.shoulderWidth;
  if (x >= outerLeft && x <= outerRight) return SURFACE_SHOULDER;
  return SURFACE_OFFFIELD;
}

export class Player {
  /**
   * @param {{ config?: typeof config }} [options]
   */
  constructor(options = {}) {
    /** @type {typeof config} */
    this.config = options.config ?? config;
    const p = this.config.player;

    this.width = p.width;
    this.height = p.height;

    /** lateral center, virtual px. Starts mid-field. */
    this.x = this.config.VIRTUAL_WIDTH / 2;
    /** vertical screen center, virtual px. Starts at the resting position. */
    this.y = this.config.VIRTUAL_HEIGHT * p.restY;
    /** forward speed relative to the road, virtual px/s (drives world scroll). */
    this.speed = 0;
    /** accrued off-road damage, 0..maxDamage. */
    this.damage = 0;
    /** true once the car leaves the field or is fully wrecked. */
    this.crashed = false;
    /** last classified surface, exposed for renderer/audio/HUD. */
    this.surface = SURFACE_ROAD;
    /**
     * Post-respawn invulnerability remaining, seconds. While > 0 the car ignores
     * all combat damage (chip + instant wreck) so it cannot be chain-wrecked the
     * moment it respawns into a busy field. Counts down in update().
     * @type {number}
     */
    this.invuln = 0;
    /**
     * Whether the car is overlapping a civilian THIS tick (set by the world's
     * collision pass, cleared at the start of each pass). A hook for SFX/HUD; not
     * a latch — see core/world.js _resolveCollisions().
     * @type {boolean}
     */
    this.touchingCivilian = false;

    // --- Boat mode (Phase 8) ---
    // AIDEV-NOTE: The player is the SAME entity in both modes (so collision,
    // scoring and the world's player.speed read-back are mode-agnostic); `mode`
    // selects car vs boat handling and the `_boat` sub-entity owns the water
    // handling/momentum. On water, update() delegates steering/throttle/y to the
    // boat then mirrors its x/y/speed back onto the player so the rest of the
    // world sees one consistent set of fields.
    /** @type {(MODE_CAR|MODE_BOAT)} current handling mode. */
    this.mode = MODE_CAR;
    /** @type {Boat} the boat sub-entity used while on water. */
    this._boat = new Boat({ config: this.config });

    // --- Ice handling (Phase 9) ---
    // AIDEV-NOTE: On dry road the car steers instantaneously (the original
    // Phase 2 feel). Under an ICE weather episode the steering becomes slippery:
    // the steer input drives a momentum-carrying lateral velocity `iceVx` eased
    // at the weather's reduced effective grip (iceTraction), so the car keeps
    // sliding after you let go and is slow to change direction. `iceVx` is only
    // live while ice is active; it is zeroed otherwise so dry handling is
    // byte-for-byte unchanged (and existing player tests keep passing).
    /** @type {number} lateral velocity carried while on ice, virtual px/s. */
    this.iceVx = 0;
  }

  /** True while the player is in boat mode (over a water section). */
  get isBoat() {
    return this.mode === MODE_BOAT;
  }

  /** True while the post-respawn invulnerability window is active. */
  get invulnerable() {
    return this.invuln > 0;
  }

  /**
   * Apply chip combat damage (Switchblade slash, Road Lord bullet, ram) toward
   * maxDamage. No-op while invulnerable or already crashed; wrecks the car when
   * the accrued damage reaches maxDamage. (spec §6 hybrid lethality.)
   * @param {number} amount damage points
   */
  applyDamage(amount) {
    if (this.crashed || this.invulnerable || !(amount > 0)) return;
    const max = this.config.player.maxDamage;
    this.damage = Math.min(max, this.damage + amount);
    if (this.damage >= max) this.crashed = true;
  }

  /**
   * Instantly wreck the car (bomb blast, rolling barrel — catastrophic hits in
   * the hybrid model). No-op while invulnerable or already crashed.
   */
  wreck() {
    if (this.crashed || this.invulnerable) return;
    this.damage = this.config.player.maxDamage;
    this.crashed = true;
  }

  /** Axis-aligned bounds for collision (later phases). */
  get bounds() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      w: this.width,
      h: this.height,
    };
  }

  /**
   * Advance the player by one fixed step. Deterministic and canvas-free.
   *
   * @param {number} dt seconds (the loop's fixed step)
   * @param {PlayerInput} input held-action snapshot
   * @param {import("../systems/road.js").Road} road the procedural road sampler
   * @param {number} distance world scroll distance at the car's row, virtual px
   * @param {import("../systems/weather.js").Weather} [weather] active weather
   *   (Phase 9). When an ICE episode is live the car's steering goes slippery;
   *   omitted/clear weather keeps the original dry handling.
   */
  update(dt, input, road, distance, weather) {
    // Post-respawn invulnerability decays in real time, regardless of state.
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    // A crashed vehicle is inert: it ignores input and just coasts to a stop.
    if (this.crashed) {
      const tune = this.isBoat ? this.config.boat : this.config.player;
      this.speed = applyThrottle(this.speed, {}, tune, dt);
      return;
    }

    const i = input ?? {};

    // --- Mode transition (car<->boat) from the road's water/boathouse markers.
    // AIDEV-NOTE: the mode is decided BEFORE handling so the boathouse frame
    // already drives with the new vehicle. modeForRoad is pure & idempotent.
    const sample = road.sampleAt(distance);
    const nextMode = modeForRoad(this.mode, sample);
    if (nextMode !== this.mode) this._switchMode(nextMode);

    if (this.mode === MODE_BOAT) {
      this._updateBoat(dt, i, sample);
    } else {
      this._updateCar(dt, i, sample, weather);
    }
  }

  /**
   * Switch between car and boat, carrying lateral position + forward speed so
   * the handoff is seamless (no teleport, no speed reset).
   * @param {(MODE_CAR|MODE_BOAT)} nextMode
   * @private
   */
  _switchMode(nextMode) {
    if (nextMode === MODE_BOAT) {
      this._boat.syncFrom({ x: this.x, y: this.y, speed: this.speed });
      this.width = this.config.boat.width;
      this.height = this.config.boat.height;
    } else {
      this._boat.writeTo(this);
      this.width = this.config.player.width;
      this.height = this.config.player.height;
    }
    this.mode = nextMode;
  }

  /**
   * Car handling for one step (the original Phase 2 behavior, plus the Phase 9
   * ICE modifier).
   * @param {PlayerInput} i
   * @param {import("../systems/road.js").RoadSample} sample
   * @param {import("../systems/weather.js").Weather} [weather]
   * @private
   */
  _updateCar(dt, i, sample, weather) {
    const p = this.config.player;

    // --- Steering: lateral move, then clamp inside the field. ---
    // AIDEV-NOTE: dry road = instantaneous lateral move (original feel, keeps
    // iceVx pinned at 0). On ICE we instead carry a lateral velocity eased at the
    // weather's reduced effective grip so the car slides: the steer input sets a
    // target lateral velocity, iceVx blends toward it slowly (boatTraction-style),
    // and x moves by iceVx*dt. Same slidy momentum model the boat uses on water.
    if (weather && weather.isIce) {
      let target = 0;
      if (i.left) target -= p.steerSpeed;
      if (i.right) target += p.steerSpeed;
      const grip = weather.effectiveGrip(p.grip);
      const k = Math.min(1, grip * dt);
      this.iceVx += (target - this.iceVx) * k;
      this.x = clampLateral(this.x + this.iceVx * dt, this.width, this.config.VIRTUAL_WIDTH);
    } else {
      this.iceVx = 0;
      let dx = 0;
      if (i.left) dx -= p.steerSpeed * dt;
      if (i.right) dx += p.steerSpeed * dt;
      this.x = clampLateral(this.x + dx, this.width, this.config.VIRTUAL_WIDTH);
    }

    // --- Throttle/brake -> forward speed. ---
    this.speed = applyThrottle(this.speed, i, p, dt);

    // --- Surface check at the car's lateral position. ---
    this.surface = surfaceAt(this.x, sample);

    if (this.surface === SURFACE_OFFFIELD) {
      // AIDEV-NOTE: fully off the play field = instant crash (spec §6). The car
      // becomes inert; the game-state machine (later phase) decides lives/reset.
      this.crashed = true;
      this.speed = applyThrottle(this.speed, {}, p, dt);
      return;
    }

    if (this.surface === SURFACE_SHOULDER) {
      // Off-road shoulder: cap speed hard and bleed off excess, accrue damage.
      if (this.speed > p.offRoadMaxSpeed) {
        this.speed = Math.max(p.offRoadMaxSpeed, this.speed - p.offRoadDrag * dt);
      }
      this.damage += p.offRoadDamagePerSec * dt;
      if (this.damage >= p.maxDamage) {
        this.damage = p.maxDamage;
        this.crashed = true;
      }
    }

    // --- Vertical screen position eases toward a speed-based target. ---
    // Faster -> the car climbs the screen (target y near minY); slower/braking
    // -> it sinks (toward maxY). Speed is normalized over [0, maxSpeed].
    const speedNorm = clamp01(this.speed / p.maxSpeed);
    const targetY = this.config.VIRTUAL_HEIGHT * lerp(p.maxY, p.minY, speedNorm);
    this.y += (targetY - this.y) * Math.min(1, p.yLerp * dt);
  }

  /**
   * Boat handling for one step. The boat sub-entity owns the slidy water
   * handling; we mirror its state back onto the player so collision / renderer /
   * world read one consistent set of fields. There is NO grass-shoulder damage
   * on water (the banks are water), but leaving the channel entirely is still a
   * crash (spec §6 "leaving the play area entirely is a crash").
   * @param {PlayerInput} i
   * @param {import("../systems/road.js").RoadSample} sample
   * @private
   */
  _updateBoat(dt, i, sample) {
    // AIDEV-NOTE: re-sync the boat FROM the player first so external writes to
    // player.x/.speed since the last tick (collision knockback, test setup) are
    // honored — the boat carries its own lateral momentum (vx) but the player is
    // the authoritative position. Then advance and mirror back.
    this._boat.x = this.x;
    this._boat.y = this.y;
    this._boat.speed = this.speed;

    this._boat.update(dt, i);
    this.x = this._boat.x;
    this.y = this._boat.y;
    this.speed = this._boat.speed;

    this.surface = surfaceAt(this.x, sample);
    if (this.surface === SURFACE_OFFFIELD) {
      this.crashed = true;
      this.speed = applyThrottle(this.speed, {}, this.config.boat, dt);
      this._boat.speed = this.speed;
    }
  }

  /**
   * Draw the player car using the shared vehicle helpers. The only canvas-
   * touching method; called by the renderer after the road is drawn.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    // On water, the boat sub-entity owns its own silhouette.
    if (this.mode === MODE_BOAT) {
      this._boat.draw(ctx);
      return;
    }
    const boosting = this.speed > this.config.player.maxSpeed * 0.55;
    drawVehicle(ctx, this.x, this.y, this.width, this.height, {
      body: this.crashed ? palette.smoke : palette.player,
      accent: palette.playerAccent,
      exhaust: palette.playerExhaust,
    }, { facing: 1, boosting, shadow: true });
  }

  /** Reset to the starting handling state (keeps config). */
  reset() {
    const p = this.config.player;
    this.width = p.width;
    this.height = p.height;
    this.x = this.config.VIRTUAL_WIDTH / 2;
    this.y = this.config.VIRTUAL_HEIGHT * p.restY;
    this.speed = 0;
    this.damage = 0;
    this.crashed = false;
    this.invuln = 0;
    this.touchingCivilian = false;
    this.surface = SURFACE_ROAD;
    this.mode = MODE_CAR;
    this.iceVx = 0;
    this._boat.reset();
  }
}

/** Clamp a value into [0, 1]. */
function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Linear interpolate from a to b by t in [0, 1]. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default Player;
