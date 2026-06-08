// test/replay.test.js
//
// DETERMINISTIC REPLAY REGRESSION GUARD (plan Phase 13, spec §10 "Replay
// smoke-test"). A fixed seed + a recorded input sequence is run for a fixed
// number of ticks through the PURE simulation (no canvas, no Web Audio, no
// requestAnimationFrame) and the end-state is asserted against a recorded
// golden snapshot.
//
// AIDEV-NOTE: This is the project's whole-system regression net. It threads the
// real World (road + player + director + spawns + set-pieces + collisions +
// scoring + weather) for 30 simulated seconds and pins the outcome. If a future
// change perturbs ANY of the deterministic pipeline (RNG ordering, handling math,
// spawn cadence, scoring, set-piece scheduling) the golden snapshot or the RNG
// cursor will shift and this test fails loudly — exactly the intent. When a
// change is intentional, re-record the GOLDEN block below from a known-good run
// (the asserts print the diff). Do NOT relax this into a fuzzy "ran without
// throwing" check: the determinism IS the contract (spec §5).
//
// Why these specific assertions:
//   * The integer/string fields (ticks, score, cars, sector, state, setpiece
//     names) are exact — they encode the gameplay outcome of the scripted run.
//   * Floats (distance, player x/y/speed) use a tight tolerance to stay robust
//     across platforms' last-ULP FP differences while still catching real drift.
//   * rngCursor pins the ENTIRE random stream after the run: it is the single
//     most sensitive tripwire — any divergence in how/when the sim consumed the
//     seeded PRNG moves it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { Game } from "../src/core/game.js";
import { GameState } from "../src/core/states.js";
import { config } from "../src/data/config.js";

// --- The recorded input sequence ------------------------------------------
//
// A pure function of the tick index, so the "recording" is compact, exact, and
// trivially reproducible (no data file to drift). It is a deliberately GENTLE
// "stay-alive" script: brief alternating steer taps to weave near road center
// (never a sustained one-way steer, which would pin the car to a wall and crash
// it off-field), with the throttle pinned and the machine gun held. Over 30 s
// this keeps the interceptor alive on the road while exercising the director's
// escalating traffic and several milestone set-pieces.
//
// AIDEV-NOTE: keep this function PURE and side-effect-free — the determinism of
// the whole test rests on it producing the same input for a given tick forever.
function scriptedInput(tick) {
  /** @type {import("../src/entities/player.js").PlayerInput & {fire?:boolean}} */
  const input = { accel: true, fire: true };
  const phase = tick % 80;
  if (phase < 12) input.left = true; // ~0.2 s left tap
  else if (phase >= 40 && phase < 52) input.right = true; // ~0.2 s right tap
  return input;
}

/** Fixed seed for the replay. Chosen so the scripted run survives the window. */
const REPLAY_SEED = 4242;
/** Number of fixed-step ticks to simulate: 30 s at 60 Hz. */
const REPLAY_TICKS = 1800;

// --- Golden end-state -------------------------------------------------------
//
// Recorded from a known-good run of the above seed + script for REPLAY_TICKS.
// If an intentional balance/logic change shifts these, re-record from output.
const GOLDEN = Object.freeze({
  ticks: 1800,
  state: "playing", // survives the full window (does not reach game over)
  // AIDEV-NOTE: re-recorded for the 2026-06 gameplay-fixes pass (concurrent cap,
  // gentler ramp, soft separation, heli wait-out/cooldown, guaranteed first
  // missiles, ricochet feedback). Every one of those shifts the seeded stream;
  // the run still survives the window. To re-record after an intentional change:
  // run this seed + scriptedInput for REPLAY_TICKS in a tiny headless script
  // (same body as runReplay) and print snapshot(world) — then paste the fields
  // here. The re-recorded run MUST still end with state "playing".
  score: 2211,
  cars: 3,
  sector: 5,
  distance: 20233.866666666607,
  playerX: 210.7377571969534,
  playerY: 396.00000000000057,
  playerSpeed: 420,
  playerSurface: "road",
  playerDamage: 32,
  setpieceNames: ["weaponsVan", "enemyWave", "weather", "weaponsVan", "enemyWave", "helicopter"],
  // The PRNG value drawn immediately AFTER the run — pins the whole stream.
  rngCursor: 0.41797392978332937,
});

/** Tight float tolerance: robust to last-ULP FP noise, catches real drift. */
const EPS = 1e-6;

/**
 * Drive a fresh World headlessly through the scripted input for `ticks` steps.
 * Pure sim: constructs nothing canvas/audio-bound.
 * @param {number} seed
 * @param {number} ticks
 * @returns {World}
 */
function runReplay(seed, ticks) {
  const world = new World({ seed }); // storage omitted -> no persistence in tests
  const dt = config.FIXED_STEP;
  for (let t = 0; t < ticks; t++) {
    world.setInput(scriptedInput(t));
    world.update(dt);
  }
  return world;
}

/**
 * Snapshot the deterministic end-state fields we assert on. Drawing the rng
 * cursor consumes one value, so only call this ONCE per world.
 * @param {World} w
 */
function snapshot(w) {
  return {
    ticks: w.ticks,
    state: w.state,
    score: w.score,
    cars: w.cars,
    sector: w.sector,
    distance: w.distance,
    playerX: w.player.x,
    playerY: w.player.y,
    playerSpeed: w.player.speed,
    playerSurface: w.player.surface,
    playerDamage: w.player.damage,
    setpieceNames: w.setpieces.map((s) => s.name),
    rngCursor: w.rng.next(),
  };
}

test("replay: fixed seed + recorded input reaches the golden end-state", () => {
  const w = runReplay(REPLAY_SEED, REPLAY_TICKS);
  const s = snapshot(w);

  // Exact (integer / string / enum) outcome fields.
  assert.equal(s.ticks, GOLDEN.ticks, "tick count");
  assert.equal(s.state, GOLDEN.state, "sim lifecycle state");
  assert.equal(s.score, GOLDEN.score, "score");
  assert.equal(s.cars, GOLDEN.cars, "spare cars");
  assert.equal(s.sector, GOLDEN.sector, "sector");
  assert.equal(s.playerSurface, GOLDEN.playerSurface, "player surface");
  assert.equal(s.playerDamage, GOLDEN.playerDamage, "player damage");
  assert.deepEqual(s.setpieceNames, GOLDEN.setpieceNames, "set-piece schedule");

  // Float fields: tight tolerance.
  assert.ok(Math.abs(s.distance - GOLDEN.distance) < EPS, `distance ${s.distance}`);
  assert.ok(Math.abs(s.playerX - GOLDEN.playerX) < EPS, `playerX ${s.playerX}`);
  assert.ok(Math.abs(s.playerY - GOLDEN.playerY) < EPS, `playerY ${s.playerY}`);
  assert.ok(Math.abs(s.playerSpeed - GOLDEN.playerSpeed) < EPS, `playerSpeed ${s.playerSpeed}`);

  // The whole-stream tripwire.
  assert.ok(
    Math.abs(s.rngCursor - GOLDEN.rngCursor) < 1e-12,
    `rngCursor drift: got ${s.rngCursor}, want ${GOLDEN.rngCursor}`,
  );
});

test("replay: the same seed + script reproduces bit-for-bit (determinism)", () => {
  const a = snapshot(runReplay(REPLAY_SEED, REPLAY_TICKS));
  const b = snapshot(runReplay(REPLAY_SEED, REPLAY_TICKS));
  // Deep-equal everything, including the RNG cursor — the run must be a pure
  // function of (seed, input sequence). Any nondeterminism trips this.
  assert.deepEqual(b, a);
});

test("replay: a different seed diverges (the seed actually drives the sim)", () => {
  // Same scripted input, different seed -> a different entity/RNG outcome. This
  // guards against accidentally hard-coding behavior independent of the seed
  // (which would make the regression net blind to RNG-path regressions).
  const golden = snapshot(runReplay(REPLAY_SEED, REPLAY_TICKS));
  const other = snapshot(runReplay(REPLAY_SEED + 1, REPLAY_TICKS));
  assert.notEqual(other.rngCursor, golden.rngCursor, "rng stream must differ");
  // The scripted distance profile is input-driven (same for both), but the
  // seeded spawn/scoring outcome must differ somewhere observable.
  assert.notDeepEqual(
    { score: other.score, setpieces: other.setpieceNames, rng: other.rngCursor },
    { score: golden.score, setpieces: golden.setpieceNames, rng: golden.rngCursor },
  );
});

test("replay: pure sim has no canvas / audio / raf coupling (headless)", () => {
  // A defensive guard that the simulation truly runs with none of the browser
  // globals present. We run a short replay with them explicitly absent; if any
  // pure-logic module reached for `window`/`document`/`AudioContext`/raf at run
  // time it would throw a ReferenceError here.
  const saved = {};
  for (const g of ["window", "document", "AudioContext", "requestAnimationFrame"]) {
    saved[g] = globalThis[g];
    delete globalThis[g];
  }
  try {
    assert.doesNotThrow(() => runReplay(REPLAY_SEED, 300));
  } finally {
    for (const g of Object.keys(saved)) {
      if (saved[g] !== undefined) globalThis[g] = saved[g];
    }
  }
});

test("replay: Game orchestrator (Enter -> play) reaches the same end-state", () => {
  // Guards the full game-flow wiring: the orchestrator must strip menu-only keys,
  // gate the sim on PLAYING, and step the SAME world deterministically. With a
  // pinned randomSeed, _beginRun() reseeds the world to REPLAY_SEED, so the run
  // must match the direct-World golden exactly.
  const game = new Game({
    seed: REPLAY_SEED,
    storage: null,
    randomSeed: () => REPLAY_SEED, // reproducible restart seed
  });
  const dt = config.FIXED_STEP;

  // Begin the run from the title screen.
  game.step(dt, { pressed: new Set(["enter"]) });
  assert.equal(game.machine.state, GameState.PLAYING, "Enter starts the run");

  // Drive the same scripted input via the held snapshot for the full window.
  for (let t = 0; t < REPLAY_TICKS; t++) {
    game.step(dt, { held: scriptedInput(t) });
  }

  const s = snapshot(game.world);
  assert.equal(s.state, GOLDEN.state);
  assert.equal(s.score, GOLDEN.score);
  assert.equal(s.cars, GOLDEN.cars);
  assert.equal(s.sector, GOLDEN.sector);
  assert.ok(Math.abs(s.distance - GOLDEN.distance) < EPS, `distance ${s.distance}`);
  assert.deepEqual(s.setpieceNames, GOLDEN.setpieceNames);
  assert.ok(Math.abs(s.rngCursor - GOLDEN.rngCursor) < 1e-12, "rng cursor matches direct World");
});
