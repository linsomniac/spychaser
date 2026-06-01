// test/boat.test.js
//
// Phase 8 — boat mode & the car<->boat transition. Per the test-first rule,
// these lock in the PURE transition logic (which mode the player should be in
// for a given road state, and the boathouse handoff) and the water-appropriate
// handling math, all decoupled from canvas/raf so they step headlessly.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MODE_CAR,
  MODE_BOAT,
  modeForRoad,
  boatTraction,
  Boat,
} from "../src/entities/boat.js";
import { config } from "../src/data/config.js";

// --- modeForRoad: the pure transition decision -------------------------------

test("modeForRoad: stays a car on dry land", () => {
  assert.equal(modeForRoad(MODE_CAR, { water: false, boathouse: null }), MODE_CAR);
  // Even if somehow a boat is on dry land, it must return to car.
  assert.equal(modeForRoad(MODE_BOAT, { water: false, boathouse: null }), MODE_CAR);
});

test("modeForRoad: the entry boathouse turns a car into a boat", () => {
  assert.equal(modeForRoad(MODE_CAR, { water: true, boathouse: "entry" }), MODE_BOAT);
});

test("modeForRoad: open water keeps the boat a boat", () => {
  assert.equal(modeForRoad(MODE_BOAT, { water: true, boathouse: null }), MODE_BOAT);
});

test("modeForRoad: the exit boathouse turns a boat back into a car", () => {
  assert.equal(modeForRoad(MODE_BOAT, { water: true, boathouse: "exit" }), MODE_CAR);
});

test("modeForRoad: a full crossing drives car -> boat -> ... -> car", () => {
  // Walk a scripted sequence of road states across one water stretch.
  const seq = [
    { water: false, boathouse: null }, // road
    { water: true, boathouse: "entry" }, // enter boathouse
    { water: true, boathouse: null }, // open water
    { water: true, boathouse: null }, // open water
    { water: true, boathouse: "exit" }, // exit boathouse
    { water: false, boathouse: null }, // back on road
  ];
  const expected = [MODE_CAR, MODE_BOAT, MODE_BOAT, MODE_BOAT, MODE_CAR, MODE_CAR];
  let mode = MODE_CAR;
  const got = [];
  for (const rstate of seq) {
    mode = modeForRoad(mode, rstate);
    got.push(mode);
  }
  assert.deepEqual(got, expected);
});

test("modeForRoad: is idempotent for a stable road state", () => {
  // Repeatedly applying the same road state must not flip-flop the mode.
  let mode = modeForRoad(MODE_CAR, { water: true, boathouse: "entry" });
  for (let i = 0; i < 5; i++) {
    mode = modeForRoad(mode, { water: true, boathouse: null });
    assert.equal(mode, MODE_BOAT);
  }
});

// --- boatTraction: water-appropriate handling --------------------------------

test("boatTraction: the boat is slidier than the car (lower grip)", () => {
  const b = config.boat;
  assert.ok(b.grip < config.player.grip, "boat grip should be lower than car grip");
});

test("boatTraction: turns a steer input into a lateral velocity within speed", () => {
  // The helper blends current lateral velocity toward the target at grip rate.
  const dt = 1 / 60;
  const grip = config.boat.grip;
  const target = config.boat.steerSpeed; // steering right at full
  let vx = 0;
  for (let i = 0; i < 600; i++) vx = boatTraction(vx, target, grip, dt);
  assert.ok(Math.abs(vx - target) < 1e-3, "lateral velocity eases to the target");
});

test("boatTraction: with no steer input the boat glides to a stop (drifts)", () => {
  const dt = 1 / 60;
  const grip = config.boat.grip;
  let vx = config.boat.steerSpeed;
  for (let i = 0; i < 600; i++) vx = boatTraction(vx, 0, grip, dt);
  assert.ok(Math.abs(vx) < 1e-3, "lateral velocity decays toward zero");
});

// --- Boat entity: water handling, no grass damage ----------------------------

test("Boat.update: steering moves the boat laterally and clamps to the field", () => {
  const boat = new Boat();
  const dt = 1 / 60;
  const startX = boat.x;
  boat.update(dt, { right: true });
  assert.ok(boat.x > startX, "steering right moves the boat right");

  for (let i = 0; i < 1200; i++) boat.update(dt, { right: true });
  assert.ok(boat.x <= config.VIRTUAL_WIDTH - boat.width / 2 + 1e-6, "clamps at right wall");

  for (let i = 0; i < 1200; i++) boat.update(dt, { left: true });
  assert.ok(boat.x >= boat.width / 2 - 1e-6, "clamps at left wall");
});

test("Boat.update: throttle drives speed and is clamped to the boat top speed", () => {
  const boat = new Boat();
  const dt = 1 / 60;
  for (let i = 0; i < 2000; i++) boat.update(dt, { accel: true });
  assert.ok(boat.speed <= config.boat.maxSpeed + 1e-6, "speed capped to boat max");
  assert.ok(boat.speed >= config.boat.maxSpeed - 1e-3, "reaches boat top speed");
});

test("Boat.update: identical inputs produce identical state (deterministic)", () => {
  const dt = 1 / 60;
  const a = new Boat();
  const b = new Boat();
  const seq = [{ accel: true }, { accel: true, right: true }, { left: true }, {}];
  for (let i = 0; i < 240; i++) {
    const inp = seq[i % seq.length];
    a.update(dt, inp);
    b.update(dt, inp);
  }
  assert.deepEqual(
    { x: a.x, vx: a.vx, speed: a.speed, y: a.y },
    { x: b.x, vx: b.vx, speed: b.speed, y: b.y },
  );
});

test("Boat: syncFrom / writeTo carry position+speed across a mode swap", () => {
  // When the player swaps car<->boat the lateral position and forward speed must
  // be preserved so the handoff is seamless (no teleport / no speed reset).
  const boat = new Boat();
  boat.syncFrom({ x: 123, y: 456, speed: 200 });
  assert.equal(boat.x, 123);
  assert.equal(boat.y, 456);
  assert.equal(boat.speed, 200);

  const sink = { x: 0, y: 0, speed: 0 };
  boat.writeTo(sink);
  assert.equal(sink.x, 123);
  assert.equal(sink.y, 456);
  assert.equal(sink.speed, 200);
});

export default null;
