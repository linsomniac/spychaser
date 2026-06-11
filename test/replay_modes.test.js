// test/replay_modes.test.js
//
// SECOND whole-system replay golden — the MODE-TRANSITION net (plan Phase 13,
// spec §10). The original test/replay.test.js pins a run that stays on the
// road the whole time (playerSurface "road", no helicopter, no ice), so the
// trickiest deterministic code — the car<->boat handoff at a boathouse, the
// missile-only Mad Bomber helicopter, and the ice-traction weather episode —
// was exercised only by isolated unit tests, never by the whole-system golden.
//
// AIDEV-NOTE: this run is chosen to actually CROSS all three. Seed 1 with a
// dead-simple straight-throttle script (no steering, so the car never weaves
// itself off-road) survives the bonus window AND reaches: the HELICOPTER
// milestone (~tick 1949), an ICE episode (~tick 2355), and BOAT mode at a water
// stretch (~tick 2597), ending the run still alive and afloat. We assert both:
//   1. latched booleans proving each mechanic was entered during the run, and
//   2. the exact deterministic end-state + rngCursor (same contract as the
//      original golden) — re-record from output if an intentional change shifts
//      the seeded stream.
//
// Boat-mode gotcha (verified): Player.surface reads "road" even while afloat —
// boat mode is Player.mode === "boat" / Player.isBoat, NOT a surface value. So
// the boat proof is player.mode, and the end-state pins playerMode, not surface.

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";

/** Seed verified to traverse ice + helicopter + boat within the window. */
const SEED = 1;
/** Long enough to cross the water stretch that begins ~tick 2611 (30 s = 1800). */
const TICKS = 2700;

// A deliberately trivial pure script: full throttle, gun held, NO steering.
// Straight-line keeps the car pinned at road center (x stays 270), which is
// what lets it survive all the way into the water stretch without weaving off.
function scriptedInput() {
  return { accel: true, fire: true };
}

const GOLDEN = Object.freeze({
  ticks: 2700,
  state: "playing", // still alive at the end of the run
  score: 2557,
  cars: 2,
  sector: 7,
  distance: 30157.73333333224,
  playerX: 270,
  playerY: 396.0478816295171,
  playerSpeed: 360, // boat top speed — the run ends afloat
  playerMode: "boat",
  playerSurface: "road", // NB: surface stays "road" in boat mode (see header)
  // Proof the run actually entered each headline mechanic at some tick.
  everIce: true,
  everHelicopter: true,
  everBoat: true,
  // Whole-stream tripwire, drawn immediately after the run.
  rngCursor: 0.18856453243643045,
});

const EPS = 1e-6;

/**
 * Drive a fresh World headlessly through the straight-throttle script, latching
 * whether it ever entered ice / helicopter / boat along the way.
 * @param {number} seed
 * @param {number} ticks
 */
function runModeReplay(seed, ticks) {
  const world = new World({ seed });
  const dt = config.FIXED_STEP;
  const visited = { everIce: false, everHelicopter: false, everBoat: false };
  for (let t = 0; t < ticks; t++) {
    world.setInput(scriptedInput(t));
    world.update(dt);
    if (world.weather.isIce) visited.everIce = true;
    if (world.helicopter !== null) visited.everHelicopter = true;
    if (world.player.isBoat) visited.everBoat = true;
  }
  return { world, visited };
}

/** Snapshot the asserted end-state. Draws the rng cursor (consumes one value). */
function snapshot({ world, visited }) {
  return {
    ticks: world.ticks,
    state: world.state,
    score: world.score,
    cars: world.cars,
    sector: world.sector,
    distance: world.distance,
    playerX: world.player.x,
    playerY: world.player.y,
    playerSpeed: world.player.speed,
    playerMode: world.player.mode,
    playerSurface: world.player.surface,
    everIce: visited.everIce,
    everHelicopter: visited.everHelicopter,
    everBoat: visited.everBoat,
    rngCursor: world.rng.next(),
  };
}

test("replay (modes): the run actually enters ice, the helicopter, and boat mode", () => {
  const s = snapshot(runModeReplay(SEED, TICKS));
  // These are the whole point of this golden: without them the mode-transition
  // code paths would regress silently (the original golden never reaches them).
  assert.equal(s.everIce, true, "run never entered an ICE episode");
  assert.equal(s.everHelicopter, true, "run never spawned the HELICOPTER");
  assert.equal(s.everBoat, true, "run never entered BOAT mode");
  assert.equal(s.playerMode, "boat", "run should end afloat in the water stretch");
});

test("replay (modes): fixed seed + straight throttle reaches the golden end-state", () => {
  const s = snapshot(runModeReplay(SEED, TICKS));

  assert.equal(s.ticks, GOLDEN.ticks, "tick count");
  assert.equal(s.state, GOLDEN.state, "sim lifecycle state");
  assert.equal(s.score, GOLDEN.score, "score");
  assert.equal(s.cars, GOLDEN.cars, "spare cars");
  assert.equal(s.sector, GOLDEN.sector, "sector");
  assert.equal(s.playerMode, GOLDEN.playerMode, "player mode (car/boat)");
  assert.equal(s.playerSurface, GOLDEN.playerSurface, "player surface");

  assert.ok(Math.abs(s.distance - GOLDEN.distance) < EPS, `distance ${s.distance}`);
  assert.ok(Math.abs(s.playerX - GOLDEN.playerX) < EPS, `playerX ${s.playerX}`);
  assert.ok(Math.abs(s.playerY - GOLDEN.playerY) < EPS, `playerY ${s.playerY}`);
  assert.ok(Math.abs(s.playerSpeed - GOLDEN.playerSpeed) < EPS, `playerSpeed ${s.playerSpeed}`);

  assert.ok(
    Math.abs(s.rngCursor - GOLDEN.rngCursor) < 1e-12,
    `rngCursor drift: got ${s.rngCursor}, want ${GOLDEN.rngCursor}`,
  );
});

test("replay (modes): the same seed + script reproduces bit-for-bit (determinism)", () => {
  const a = snapshot(runModeReplay(SEED, TICKS));
  const b = snapshot(runModeReplay(SEED, TICKS));
  assert.deepEqual(b, a);
});
