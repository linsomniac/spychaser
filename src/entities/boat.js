// entities/boat.js
//
// Boat mode for the water sections (spec §6 "Water sections"). When the player
// drives into the boathouse at the head of a water stretch the interceptor is
// swapped for a boat; on reaching the boathouse at the far end it swaps back to
// the car. The boat handles differently from the car: slidier, momentum-carrying
// steering (lower grip), a slightly lower top speed, and NO grass-shoulder
// damage (the banks beside the channel are water, not verge — leaving the field
// entirely is still a crash, handled by the Player).
//
// AIDEV-NOTE: All handling math here is PURE and decoupled from canvas/raf. The
// core helpers (modeForRoad, boatTraction) and Boat.update are unit-tested in
// test/boat.test.js. The car<->boat transition is a function of the road's water
// + boathouse markers ONLY (modeForRoad) so it is deterministic and replayable.
// Drawing lives in draw(ctx) and is the only canvas-touching part.

import { config } from "../data/config.js";
import { palette } from "../data/palette.js";
import { roundedRectPath } from "../render/shapes.js";
import { clampLateral, applyThrottle } from "./player.js";

/** The player is driving the interceptor on the road. */
export const MODE_CAR = "car";
/** The player is piloting the boat over a water section. */
export const MODE_BOAT = "boat";

/**
 * Decide which vehicle mode the player should be in for a given road state. This
 * is the single source of truth for the car<->boat transition and is a PURE
 * function of (currentMode, roadState) — no travel-direction or timing state.
 *
 * Rules (the player only ever travels forward, so "entry" precedes "exit"):
 *   * dry land            -> always MODE_CAR
 *   * entry boathouse     -> swap to MODE_BOAT (we are entering the water)
 *   * open water          -> keep the current mode (already a boat by then)
 *   * exit  boathouse     -> swap to MODE_CAR (we are leaving the water)
 *
 * AIDEV-NOTE: open water keeps the *current* mode rather than forcing BOAT so a
 * single mis-sampled frame can't flip the mode; the entry boathouse is what
 * commits car->boat and the exit boathouse commits boat->car. Idempotent: the
 * same road state never flip-flops the mode (see the idempotence test).
 *
 * @param {(MODE_CAR|MODE_BOAT)} currentMode
 * @param {{water:boolean, boathouse:("entry"|"exit"|null)}} roadState
 * @returns {(MODE_CAR|MODE_BOAT)}
 */
export function modeForRoad(currentMode, roadState) {
  if (!roadState.water) return MODE_CAR;
  if (roadState.boathouse === "entry") return MODE_BOAT;
  if (roadState.boathouse === "exit") return MODE_CAR;
  // Open water: preserve whatever we already were.
  return currentMode;
}

/**
 * Advance a lateral velocity toward a steering target with water "grip". Pure:
 * blends the current vx toward `target` by a clamped factor of grip*dt so the
 * boat carries momentum (it keeps sliding when you let go of the stick and takes
 * time to change direction). Lower grip => slidier.
 *
 * @param {number} vx     current lateral velocity, virtual px/s
 * @param {number} target desired lateral velocity (steerSpeed * steer input)
 * @param {number} grip   easing rate per second (config.boat.grip)
 * @param {number} dt     seconds
 * @returns {number} new lateral velocity
 */
export function boatTraction(vx, target, grip, dt) {
  const k = Math.min(1, grip * dt);
  return vx + (target - vx) * k;
}

export class Boat {
  /**
   * @param {{ config?: typeof config }} [options]
   */
  constructor(options = {}) {
    /** @type {typeof config} */
    this.config = options.config ?? config;
    const b = this.config.boat;

    this.width = b.width;
    this.height = b.height;

    /** lateral center, virtual px. */
    this.x = this.config.VIRTUAL_WIDTH / 2;
    /** vertical screen center, virtual px. */
    this.y = this.config.VIRTUAL_HEIGHT * this.config.player.restY;
    /** forward speed relative to the water, virtual px/s (drives world scroll). */
    this.speed = 0;
    /** lateral velocity, virtual px/s — momentum the water carries. */
    this.vx = 0;
  }

  /** Axis-aligned bounds for collision, matching the Player interface. */
  get bounds() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      w: this.width,
      h: this.height,
    };
  }

  /**
   * Advance the boat by one fixed step. Deterministic and canvas-free. Unlike
   * the car, the boat has no road sampling here — water handling does not punish
   * the shoulder; the Player owns the leave-the-channel crash check.
   *
   * @param {number} dt seconds (the loop's fixed step)
   * @param {import("./player.js").PlayerInput} input held-action snapshot
   */
  update(dt, input) {
    const b = this.config.boat;
    const i = input ?? {};

    // --- Steering: blend lateral velocity toward the steer target (slidy). ---
    let target = 0;
    if (i.left) target -= b.steerSpeed;
    if (i.right) target += b.steerSpeed;
    this.vx = boatTraction(this.vx, target, b.grip, dt);
    this.x = clampLateral(this.x + this.vx * dt, this.width, this.config.VIRTUAL_WIDTH);

    // --- Throttle/brake -> forward speed (same curve as the car, boat limits).
    this.speed = applyThrottle(this.speed, i, b, dt);

    // --- Vertical screen position eases toward a speed-based target. ---
    const p = this.config.player;
    const speedNorm = clamp01(this.speed / b.maxSpeed);
    const targetY = this.config.VIRTUAL_HEIGHT * lerp(p.maxY, p.minY, speedNorm);
    this.y += (targetY - this.y) * Math.min(1, p.yLerp * dt);
  }

  /**
   * Copy position + forward speed FROM a source (the car) so the handoff into
   * boat mode is seamless (no teleport, no speed reset). Lateral momentum starts
   * at zero — the boat is freshly afloat.
   * @param {{x:number, y:number, speed:number}} src
   */
  syncFrom(src) {
    this.x = src.x;
    this.y = src.y;
    this.speed = src.speed;
    this.vx = 0;
  }

  /**
   * Copy position + forward speed INTO a sink (the car) when swapping back so the
   * car resumes exactly where the boat left off.
   * @param {{x:number, y:number, speed:number}} sink
   */
  writeTo(sink) {
    sink.x = this.x;
    sink.y = this.y;
    sink.speed = this.speed;
  }

  /**
   * Draw the boat: a rounded hull with a pointed bow and a small cockpit, in the
   * player palette so it reads as "still the hero". The only canvas-touching
   * method; called by the renderer. Faces "up" like the car.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.translate(this.x, this.y);

    // Soft drop shadow on the water.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(2.5, 3.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hull: a hexagonal "boat" silhouette pointing up (bow at -y).
    ctx.fillStyle = palette.player;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2); // bow tip
    ctx.lineTo(w / 2, -h * 0.18);
    ctx.lineTo(w / 2, h * 0.42);
    ctx.lineTo(0, h / 2); // stern (slight point)
    ctx.lineTo(-w / 2, h * 0.42);
    ctx.lineTo(-w / 2, -h * 0.18);
    ctx.closePath();
    ctx.fill();

    // Cockpit / canopy near the bow.
    ctx.fillStyle = palette.playerAccent;
    roundedRectPath(ctx, 0, -h * 0.1, w * 0.5, h * 0.24, w * 0.12);
    ctx.fill();

    ctx.restore();
  }

  /** Reset to the starting handling state (keeps config). */
  reset() {
    this.x = this.config.VIRTUAL_WIDTH / 2;
    this.y = this.config.VIRTUAL_HEIGHT * this.config.player.restY;
    this.speed = 0;
    this.vx = 0;
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

export default Boat;
