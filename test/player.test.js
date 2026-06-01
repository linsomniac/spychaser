// test/player.test.js
//
// Tests for the player handling math (entities/player.js). Per the test-first
// rule, these lock in the pure arcade-handling behavior: the acceleration curve,
// the lateral steering clamp to the play field, the off-road shoulder penalty,
// and the leave-the-field crash. The Player class is decoupled from canvas, so
// it can be stepped headlessly here exactly as the simulation does.

import test from "node:test";
import assert from "node:assert/strict";

import {
  Player,
  applyThrottle,
  clampLateral,
  surfaceAt,
  SURFACE_ROAD,
  SURFACE_SHOULDER,
  SURFACE_OFFFIELD,
} from "../src/entities/player.js";
import { MODE_CAR, MODE_BOAT } from "../src/entities/boat.js";
import { config } from "../src/data/config.js";
import { Road } from "../src/systems/road.js";

/**
 * Find a distance inside the first water stretch for a seed, and the boathouse
 * entry/exit distances for it. Used by the boat-transition tests.
 */
function firstWaterSection(seed) {
  const r = new Road({ seed });
  for (let d = 0; d <= 400000; d += 13) {
    const sect = r.waterSectionAt(d);
    if (sect) return { road: r, ...sect };
  }
  throw new Error(`no water section found for seed ${seed}`);
}

const P = config.player;

// --- Acceleration curve -----------------------------------------------------

test("applyThrottle: accelerating from rest increases speed toward maxSpeed", () => {
  const dt = 1 / 60;
  let speed = 0;
  const before = speed;
  speed = applyThrottle(speed, { accel: true, brake: false }, P, dt);
  assert.ok(speed > before, "throttle should raise speed");
  // One step of accel = accel * dt.
  assert.ok(Math.abs(speed - P.accel * dt) < 1e-9);
});

test("applyThrottle: speed is clamped to maxSpeed and never overshoots", () => {
  const dt = 1 / 60;
  let speed = 0;
  // Run far longer than needed to reach top speed.
  for (let i = 0; i < 1000; i++) {
    speed = applyThrottle(speed, { accel: true, brake: false }, P, dt);
  }
  assert.ok(speed <= P.maxSpeed + 1e-9, "must not exceed maxSpeed");
  assert.ok(speed >= P.maxSpeed - 1e-6, "should reach maxSpeed");
});

test("applyThrottle: the accel curve is monotonic and decelerates while braking", () => {
  const dt = 1 / 60;
  let speed = 0;
  let prev = -Infinity;
  // Accelerating: each step is >= the previous speed until capped.
  for (let i = 0; i < 200; i++) {
    speed = applyThrottle(speed, { accel: true, brake: false }, P, dt);
    assert.ok(speed >= prev - 1e-9, "accel must be monotonic non-decreasing");
    prev = speed;
  }
  // Braking from top speed reduces speed.
  const high = speed;
  speed = applyThrottle(speed, { accel: false, brake: true }, P, dt);
  assert.ok(speed < high, "braking should reduce speed");
});

test("applyThrottle: braking is clamped to minSpeed (no infinite reverse)", () => {
  const dt = 1 / 60;
  let speed = 0;
  for (let i = 0; i < 1000; i++) {
    speed = applyThrottle(speed, { accel: false, brake: true }, P, dt);
  }
  assert.ok(speed >= P.minSpeed - 1e-9, "must not drop below minSpeed");
  assert.ok(speed <= P.minSpeed + 1e-6, "should reach minSpeed");
});

test("applyThrottle: coasting (no input) drifts toward zero, not negative", () => {
  const dt = 1 / 60;
  let speed = P.maxSpeed;
  for (let i = 0; i < 1000; i++) {
    speed = applyThrottle(speed, { accel: false, brake: false }, P, dt);
  }
  assert.ok(speed >= -1e-6, "coasting should not reverse the car");
  assert.ok(speed <= 1e-6, "coasting should settle near zero");
});

// --- Steering clamp ---------------------------------------------------------

test("clampLateral: keeps x within the field margins", () => {
  const W = config.VIRTUAL_WIDTH;
  const halfW = P.width / 2;
  // Way past the right edge -> clamped to W - halfW.
  assert.equal(clampLateral(9999, P.width, W), W - halfW);
  // Way past the left edge -> clamped to halfW.
  assert.equal(clampLateral(-9999, P.width, W), halfW);
  // Inside the field is untouched.
  assert.equal(clampLateral(W / 2, P.width, W), W / 2);
});

test("Player.update: steering right then left moves x and respects the clamp", () => {
  const road = new Road({ seed: 1 });
  const dt = 1 / 60;
  const player = new Player();
  const startX = player.x;

  player.update(dt, { right: true }, road, 0);
  assert.ok(player.x > startX, "steering right increases x");

  // Hold right long enough to hit the right wall; x must clamp, not run off.
  for (let i = 0; i < 600; i++) player.update(dt, { right: true }, road, 0);
  assert.ok(player.x <= config.VIRTUAL_WIDTH - P.width / 2 + 1e-9);

  // Now steer hard left; x must clamp at the left margin.
  for (let i = 0; i < 600; i++) player.update(dt, { left: true }, road, 0);
  assert.ok(player.x >= P.width / 2 - 1e-9);
});

// --- Off-road surface + penalty ---------------------------------------------

test("surfaceAt: classifies road, shoulder, and off-field by x", () => {
  const road = new Road({ seed: 1 });
  const s = road.sampleAt(0);
  const mid = s.centerX; // dead center of the road body
  const onShoulder = s.leftEdge - s.shoulderWidth / 2; // middle of left verge
  const offField = s.leftEdge - s.shoulderWidth - 50; // beyond the verge

  assert.equal(surfaceAt(mid, s), SURFACE_ROAD);
  assert.equal(surfaceAt(onShoulder, s), SURFACE_SHOULDER);
  assert.equal(surfaceAt(offField, s), SURFACE_OFFFIELD);
});

test("Player.update: driving on the shoulder slows the car and deals damage", () => {
  const road = new Road({ seed: 1 });
  const dt = 1 / 60;
  const s = road.sampleAt(0);

  // On-road control: accelerate at center for a fixed number of ticks.
  const onRoad = new Player();
  onRoad.x = s.centerX;
  for (let i = 0; i < 120; i++) onRoad.update(dt, { accel: true }, road, 0);

  // Off-road: same accel input but parked on the shoulder.
  const offRoad = new Player();
  offRoad.x = s.leftEdge - s.shoulderWidth / 2;
  for (let i = 0; i < 120; i++) {
    offRoad.update(dt, { accel: true }, road, 0);
    // Pin it on the shoulder each tick so steering drift can't pull it back.
    offRoad.x = s.leftEdge - s.shoulderWidth / 2;
  }

  assert.ok(offRoad.speed < onRoad.speed, "shoulder must cap/slow speed");
  assert.ok(offRoad.speed <= P.offRoadMaxSpeed + 1e-6, "speed capped to off-road max");
  assert.ok(offRoad.damage > 0, "shoulder driving causes damage");
  assert.equal(onRoad.damage, 0, "on-road driving causes no damage");
});

// --- Leaving the field = crash ----------------------------------------------

test("Player.update: leaving the play field triggers a crash", () => {
  const road = new Road({ seed: 1 });
  const dt = 1 / 60;
  const s = road.sampleAt(0);

  const player = new Player();
  assert.equal(player.crashed, false);

  // Force the car off the field (past the grass verge entirely), then update.
  player.x = s.leftEdge - s.shoulderWidth - 30;
  player.update(dt, {}, road, 0);
  assert.equal(player.crashed, true, "off-field must crash the player");
});

test("Player.update: a crashed player stops responding to input", () => {
  const road = new Road({ seed: 1 });
  const dt = 1 / 60;
  const s = road.sampleAt(0);

  const player = new Player();
  player.x = s.leftEdge - s.shoulderWidth - 30;
  player.update(dt, {}, road, 0); // crash
  assert.equal(player.crashed, true);

  const speedAtCrash = player.speed;
  player.update(dt, { accel: true, right: true }, road, 0);
  assert.ok(player.speed <= speedAtCrash + 1e-9, "crashed car ignores throttle");
});

// --- Boat mode transition (Phase 8) -----------------------------------------

test("Player.update: starts in car mode on dry road", () => {
  const road = new Road({ seed: 1 });
  const player = new Player();
  player.update(1 / 60, { accel: true }, road, 0);
  assert.equal(player.mode, MODE_CAR);
});

test("Player.update: driving into the boathouse switches car -> boat and back", () => {
  const { road, start, end } = firstWaterSection(2026);
  const player = new Player();
  const dt = 1 / 60;

  // Approach distance just before the water: still a car.
  player.update(dt, {}, road, start - 50);
  assert.equal(player.mode, MODE_CAR, "still a car before the water");

  // Inside the entry boathouse: swaps to boat.
  player.update(dt, {}, road, start + 1);
  assert.equal(player.mode, MODE_BOAT, "entry boathouse swaps to boat");

  // Open water: stays a boat.
  const mid = (start + end) / 2;
  player.update(dt, {}, road, mid);
  assert.equal(player.mode, MODE_BOAT, "open water keeps the boat");

  // Exit boathouse: swaps back to a car.
  player.update(dt, {}, road, end - 1);
  assert.equal(player.mode, MODE_CAR, "exit boathouse swaps back to a car");

  // Back on dry road: remains a car.
  player.update(dt, {}, road, end + 50);
  assert.equal(player.mode, MODE_CAR, "dry road after the water is a car");
});

test("Player.update: the car<->boat handoff preserves x and speed (no teleport)", () => {
  const { road, start } = firstWaterSection(2026);
  const player = new Player();
  const dt = 1 / 60;

  // Build up a moderate speed (below the boat's top speed so the carry is clean,
  // not a legitimate clamp) and shift laterally while still on the road.
  player.x = config.VIRTUAL_WIDTH / 2 + 30;
  for (let i = 0; i < 20; i++) player.update(dt, { accel: true }, road, start - 200);
  const xBefore = player.x;
  const speedBefore = player.speed;
  assert.ok(speedBefore < config.boat.maxSpeed, "test premise: car under boat top speed");

  // Cross into the boathouse: handoff should keep position + forward speed
  // (one physics step of coast/steer is expected, but no teleport / no reset).
  player.update(dt, {}, road, start + 1);
  assert.equal(player.mode, MODE_BOAT);
  // Lateral position carries exactly (boat re-syncs from the player's x; with no
  // steer input its lateral velocity stays zero this frame).
  assert.ok(Math.abs(player.x - xBefore) < 1e-6, "x preserved across handoff");
  // Forward speed carries within one frame of coast deceleration (no reset).
  const maxCoast = config.boat.coastDecel * dt + 1e-6;
  assert.ok(
    Math.abs(player.speed - speedBefore) <= maxCoast,
    `speed preserved across handoff (delta ${Math.abs(player.speed - speedBefore)})`,
  );
  assert.ok(player.speed > speedBefore * 0.5, "speed not reset on handoff");
});

test("Player.update: on water there is no grass-shoulder damage", () => {
  const { road, start, end } = firstWaterSection(2026);
  const player = new Player();
  const dt = 1 / 60;
  const mid = (start + end) / 2;

  // Enter the water first so we are a boat.
  player.update(dt, {}, road, start + 1);
  assert.equal(player.mode, MODE_BOAT);

  // Pin the player far to the side and drive on open water; no damage accrues
  // (the banks are water, not grass — leaving the channel is the crash check).
  const s = road.sampleAt(mid);
  player.x = s.leftEdge + 5; // near the channel edge but inside
  for (let i = 0; i < 120; i++) {
    player.update(dt, { accel: true }, road, mid);
    player.x = s.leftEdge + 5;
  }
  assert.equal(player.damage, 0, "no shoulder damage in boat mode");
  assert.equal(player.crashed, false, "still afloat inside the channel");
});

test("Player.update: leaving the water channel entirely still crashes", () => {
  const { road, start, end } = firstWaterSection(2026);
  const player = new Player();
  const dt = 1 / 60;
  const mid = (start + end) / 2;

  // Become a boat.
  player.update(dt, {}, road, start + 1);
  assert.equal(player.mode, MODE_BOAT);

  // Shove the boat well past the bank (off the field) and update.
  const s = road.sampleAt(mid);
  player.x = s.leftEdge - s.shoulderWidth - 40;
  player.update(dt, {}, road, mid);
  assert.equal(player.crashed, true, "off-field on water is still a crash");
});

// --- Determinism ------------------------------------------------------------

test("Player.update: identical inputs produce identical state", () => {
  const dt = 1 / 60;
  const roadA = new Road({ seed: 3 });
  const roadB = new Road({ seed: 3 });
  const a = new Player();
  const b = new Player();
  const seq = [{ accel: true }, { accel: true, right: true }, { left: true }, {}];
  for (let i = 0; i < 240; i++) {
    const inp = seq[i % seq.length];
    a.update(dt, inp, roadA, i * 2);
    b.update(dt, inp, roadB, i * 2);
  }
  assert.deepEqual(
    { x: a.x, y: a.y, speed: a.speed, damage: a.damage, crashed: a.crashed },
    { x: b.x, y: b.y, speed: b.speed, damage: b.damage, crashed: b.crashed },
  );
});

export default null;
