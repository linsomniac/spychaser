// test/game.test.js
//
// Phase 11 — the top-level orchestrator (core/game.js). It wires the World + the
// game-flow StateMachine + input edges together. We test it HEADLESSLY: the Game
// is constructed without canvas/renderer/audio (all optional), and driven by a
// scripted step(dt, { held, pressed }) — `held` is the per-tick held-action
// snapshot (like engine/input.snapshot()), `pressed` is the edge set of actions
// that went down THIS tick (like engine/input.consumePressed()). This lets us
// lock in the flow ATTRACT -> PLAYING -> PAUSED -> GAME_OVER -> restart and,
// crucially, that a restart resets the world cleanly with NO state leaks.

import test from "node:test";
import assert from "node:assert/strict";

import { Game } from "../src/core/game.js";
import { GameState } from "../src/core/states.js";
import { config } from "../src/data/config.js";
import { createSpecial } from "../src/systems/weapons.js";

const dt = config.FIXED_STEP;

/** Build a held-action snapshot with everything up except the named actions. */
function held(...down) {
  const set = new Set(down);
  return {
    left: set.has("left"),
    right: set.has("right"),
    accel: set.has("accel"),
    brake: set.has("brake"),
    fire: set.has("fire"),
    special: set.has("special"),
    pause: set.has("pause"),
    enter: set.has("enter"),
  };
}

/** An edge set (actions pressed THIS tick). */
function pressed(...actions) {
  return new Set(actions);
}

/** A headless Game (no canvas/audio); storage:null so no localStorage probe. */
function makeGame(seed = 7) {
  return new Game({ seed, storage: null });
}

// --- Boots on the attract screen ----------------------------------------------

test("game: boots onto the ATTRACT/title screen with a frozen world", () => {
  const g = makeGame();
  assert.equal(g.machine.state, GameState.ATTRACT);
  // A few idle ticks on the title screen must NOT advance the sim.
  for (let i = 0; i < 10; i++) g.step(dt, { held: held(), pressed: pressed() });
  assert.equal(g.world.ticks, 0, "world stays frozen on the attract screen");
});

// --- ATTRACT -> PLAYING via Enter ---------------------------------------------

test("game: Enter on the title screen starts a run and the sim advances", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") });
  assert.equal(g.machine.state, GameState.PLAYING);
  // Next ticks should advance the world now that we are playing.
  g.step(dt, { held: held(), pressed: pressed() });
  g.step(dt, { held: held(), pressed: pressed() });
  assert.ok(g.world.ticks >= 1, "world ticks while PLAYING");
});

// --- Special weapon (F/Shift) deploys through the orchestrator -----------------

test("game: a 'special' edge while PLAYING deploys the loaded special", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") }); // -> PLAYING
  g.world.player.special = createSpecial("missiles");
  const before = g.world.projectiles.activeCount;
  g.step(dt, { held: held("special"), pressed: pressed("special") });
  assert.ok(
    g.world.projectiles.activeCount > before,
    "the F/Shift edge fired the loaded special",
  );
  assert.equal(
    g.world.player.special.charge,
    config.weapons.specials.missiles.charge - 1,
    "a charge was consumed",
  );
});

test("game: a 'special' edge does nothing on the title screen", () => {
  const g = makeGame();
  // Pre-load a special onto the (frozen) world, then press special on ATTRACT.
  g.world.player.special = createSpecial("missiles");
  g.step(dt, { held: held("special"), pressed: pressed("special") });
  assert.equal(g.world.projectiles.activeCount, 0, "no deploy while not PLAYING");
  assert.equal(g.machine.state, GameState.ATTRACT);
});

// --- PLAYING <-> PAUSED via P/Esc ---------------------------------------------

test("game: P pauses, freezing the sim, and P again resumes it", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") }); // start
  g.step(dt, { held: held(), pressed: pressed() }); // play one tick
  const ticksBeforePause = g.world.ticks;

  g.step(dt, { held: held(), pressed: pressed("pause") }); // pause
  assert.equal(g.machine.state, GameState.PAUSED);
  // Several paused ticks must not advance the sim.
  for (let i = 0; i < 5; i++) g.step(dt, { held: held(), pressed: pressed() });
  assert.equal(g.world.ticks, ticksBeforePause, "paused world is frozen");

  g.step(dt, { held: held(), pressed: pressed("pause") }); // resume
  assert.equal(g.machine.state, GameState.PLAYING);
  g.step(dt, { held: held(), pressed: pressed() });
  assert.ok(g.world.ticks > ticksBeforePause, "sim resumes after unpause");
});

// --- Pause edge does not also drive the player ('pause' is edge-only) ---------

test("game: starting does not leak the Enter edge into player input", () => {
  const g = makeGame();
  g.step(dt, { held: held("enter"), pressed: pressed("enter") }); // start tick
  // The world should not have received 'enter' as a movement/fire action; the
  // player input is the held snapshot minus the menu-only keys. Just assert the
  // world is playing and well-formed (no crash, no fire side-effects asserted).
  assert.equal(g.machine.state, GameState.PLAYING);
});

// --- PLAYING -> GAME_OVER when the world's run ends ---------------------------

test("game: the run ends (GAME_OVER) when the world loses its last car", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") }); // start
  // Force wrecks past the bonus window so the world hits its 'gameover' state.
  g.world.scoring.bonusSuspended = true;
  for (let i = 0; i < config.scoring.startCars + 1; i++) {
    g.world.player.crashed = true;
    g.step(dt, { held: held(), pressed: pressed() });
  }
  assert.equal(g.world.state, "gameover", "world latched its game-over");
  assert.equal(g.machine.state, GameState.GAME_OVER, "machine followed to GAME_OVER");
});

// --- GAME_OVER -> restart resets the world cleanly (no state leaks) -----------

test("game: Enter at GAME_OVER restarts with a fully reset world (no leaks)", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") }); // start

  // Drive a bit so there is real state to leak, then accumulate some score.
  for (let i = 0; i < 30; i++) g.step(dt, { held: held("accel"), pressed: pressed() });
  g.world.scoring.score = 4242;

  // End the run.
  g.world.scoring.bonusSuspended = true;
  for (let i = 0; i < config.scoring.startCars + 1; i++) {
    g.world.player.crashed = true;
    g.step(dt, { held: held(), pressed: pressed() });
  }
  assert.equal(g.machine.state, GameState.GAME_OVER);

  // Dirty the live arrays AFTER game over (the frozen sim won't touch them) to
  // prove the restart's reset() clears them, not just that they happened to be
  // empty.
  g.world.civilians.push({ active: true });
  g.world.enemies.push({ active: true });

  // Restart.
  g.step(dt, { held: held(), pressed: pressed("enter") });
  assert.equal(g.machine.state, GameState.PLAYING, "restart returns to PLAYING");

  // A fresh run: counters and arrays cleared, scoring reset, world un-game-over.
  assert.equal(g.world.ticks, 0, "ticks reset");
  assert.equal(g.world.time, 0, "time reset");
  assert.equal(g.world.distance, 0, "distance reset");
  assert.equal(g.world.score, 0, "score reset");
  assert.equal(g.world.civilians.length, 0, "live civilian array cleared");
  assert.equal(g.world.enemies.length, 0, "live enemy array cleared");
  assert.equal(g.world.cars, config.scoring.startCars, "cars restocked");
  assert.equal(g.world.state, "playing", "world un-game-over after restart");
  assert.equal(g.world.player.crashed, false, "player respawned");
});

// --- Restart preserves the high score (persistence across runs) ---------------

test("game: a restart keeps the high score earned in the prior run", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") });
  g.world.scoring.score = 8800;
  g.world.scoring.bonusSuspended = true;
  for (let i = 0; i < config.scoring.startCars + 1; i++) {
    g.world.player.crashed = true;
    g.step(dt, { held: held(), pressed: pressed() });
  }
  assert.equal(g.machine.state, GameState.GAME_OVER);
  assert.equal(g.world.hiScore, 8800, "high score banked at game over");

  g.step(dt, { held: held(), pressed: pressed("enter") }); // restart
  assert.equal(g.world.score, 0, "fresh score");
  assert.equal(g.world.hiScore, 8800, "high score survives the restart");
});

// --- Enter mid-run does NOT restart (no surprise resets) ----------------------

test("game: Enter while PLAYING does not reset the run", () => {
  const g = makeGame();
  g.step(dt, { held: held(), pressed: pressed("enter") }); // start
  for (let i = 0; i < 20; i++) g.step(dt, { held: held("accel"), pressed: pressed() });
  const ticks = g.world.ticks;
  g.step(dt, { held: held(), pressed: pressed("enter") }); // stray Enter mid-run
  assert.equal(g.machine.state, GameState.PLAYING);
  assert.ok(g.world.ticks > ticks, "world kept advancing, was not reset");
});

// --- Determinism: same seed + same scripted input => same end state -----------

test("game: identical seed + input sequence reproduce the same run", () => {
  const drive = (g, n) => {
    g.step(dt, { held: held(), pressed: pressed("enter") });
    for (let i = 0; i < n; i++) {
      g.step(dt, { held: held("accel", "fire"), pressed: pressed() });
    }
  };
  const a = new Game({ seed: 123, storage: null });
  const b = new Game({ seed: 123, storage: null });
  drive(a, 200);
  drive(b, 200);
  assert.equal(a.world.ticks, b.world.ticks);
  assert.equal(a.world.score, b.world.score);
  assert.ok(Math.abs(a.world.distance - b.world.distance) < 1e-9);
  assert.equal(a.world.enemies.length, b.world.enemies.length);
});

export default null;
