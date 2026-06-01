// test/states.test.js
//
// Phase 11 — the top-level game-flow state machine (ATTRACT -> PLAYING ->
// PAUSED -> GAME_OVER). Test-first per the plan. This is PURE logic, fully
// decoupled from canvas / raf / Web Audio / the World (spec §5): it only tracks
// which screen we are on and which transitions are legal, so it can be stepped
// headlessly. The orchestrator (core/game.js) drives it from input edges and the
// world's lifecycle; here we lock in the transition table itself.

import test from "node:test";
import assert from "node:assert/strict";

import { GameState, StateMachine } from "../src/core/states.js";

// --- The state set ------------------------------------------------------------

test("states: exposes the four game-flow states", () => {
  assert.equal(GameState.ATTRACT, "attract");
  assert.equal(GameState.PLAYING, "playing");
  assert.equal(GameState.PAUSED, "paused");
  assert.equal(GameState.GAME_OVER, "gameover");
});

// --- Initial state ------------------------------------------------------------

test("states: a fresh machine starts on the ATTRACT/title screen", () => {
  const m = new StateMachine();
  assert.equal(m.state, GameState.ATTRACT);
});

test("states: the initial state can be overridden", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  assert.equal(m.state, GameState.PLAYING);
});

// --- ATTRACT -> PLAYING -------------------------------------------------------

test("states: start() begins play from the title screen", () => {
  const m = new StateMachine();
  const moved = m.start();
  assert.equal(moved, true);
  assert.equal(m.state, GameState.PLAYING);
});

test("states: start() is a no-op while already playing", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  const moved = m.start();
  assert.equal(moved, false);
  assert.equal(m.state, GameState.PLAYING);
});

// --- PLAYING <-> PAUSED -------------------------------------------------------

test("states: togglePause() pauses while playing and resumes while paused", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  assert.equal(m.togglePause(), true);
  assert.equal(m.state, GameState.PAUSED);
  assert.equal(m.togglePause(), true);
  assert.equal(m.state, GameState.PLAYING);
});

test("states: togglePause() does nothing on the title or game-over screens", () => {
  const attract = new StateMachine({ initial: GameState.ATTRACT });
  assert.equal(attract.togglePause(), false);
  assert.equal(attract.state, GameState.ATTRACT);

  const over = new StateMachine({ initial: GameState.GAME_OVER });
  assert.equal(over.togglePause(), false);
  assert.equal(over.state, GameState.GAME_OVER);
});

test("states: isPaused reflects only the PAUSED state", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  assert.equal(m.isPaused, false);
  m.togglePause();
  assert.equal(m.isPaused, true);
});

// --- PLAYING -> GAME_OVER -----------------------------------------------------

test("states: gameOver() ends the run from PLAYING", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  const moved = m.gameOver();
  assert.equal(moved, true);
  assert.equal(m.state, GameState.GAME_OVER);
});

test("states: gameOver() also ends from PAUSED (defensive)", () => {
  const m = new StateMachine({ initial: GameState.PAUSED });
  assert.equal(m.gameOver(), true);
  assert.equal(m.state, GameState.GAME_OVER);
});

test("states: gameOver() is a no-op on the attract screen", () => {
  const m = new StateMachine({ initial: GameState.ATTRACT });
  assert.equal(m.gameOver(), false);
  assert.equal(m.state, GameState.ATTRACT);
});

test("states: gameOver() is idempotent once already over", () => {
  const m = new StateMachine({ initial: GameState.GAME_OVER });
  assert.equal(m.gameOver(), false);
  assert.equal(m.state, GameState.GAME_OVER);
});

// --- GAME_OVER -> PLAYING (restart) ------------------------------------------

test("states: restart() begins a new run from the game-over screen", () => {
  const m = new StateMachine({ initial: GameState.GAME_OVER });
  const moved = m.restart();
  assert.equal(moved, true);
  assert.equal(m.state, GameState.PLAYING);
});

test("states: restart() also starts from the title screen (Enter on attract)", () => {
  const m = new StateMachine({ initial: GameState.ATTRACT });
  assert.equal(m.restart(), true);
  assert.equal(m.state, GameState.PLAYING);
});

test("states: restart() is a no-op mid-run (no surprise resets while playing)", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  assert.equal(m.restart(), false);
  assert.equal(m.state, GameState.PLAYING);
});

// --- toTitle() (back to attract) ---------------------------------------------

test("states: toTitle() returns to the attract screen from game over", () => {
  const m = new StateMachine({ initial: GameState.GAME_OVER });
  assert.equal(m.toTitle(), true);
  assert.equal(m.state, GameState.ATTRACT);
});

// --- Convenience predicates ---------------------------------------------------

test("states: predicates report the active screen", () => {
  const m = new StateMachine();
  assert.equal(m.isAttract, true);
  assert.equal(m.isPlaying, false);
  m.start();
  assert.equal(m.isPlaying, true);
  assert.equal(m.isAttract, false);
  m.gameOver();
  assert.equal(m.isGameOver, true);
});

// --- "Should the sim advance?" gate ------------------------------------------

test("states: shouldSimulate is true only while actively PLAYING", () => {
  const m = new StateMachine();
  assert.equal(m.shouldSimulate, false, "attract: frozen");
  m.start();
  assert.equal(m.shouldSimulate, true, "playing: live");
  m.togglePause();
  assert.equal(m.shouldSimulate, false, "paused: frozen");
  m.togglePause();
  m.gameOver();
  assert.equal(m.shouldSimulate, false, "game over: frozen");
});

// --- onChange hook ------------------------------------------------------------

test("states: onChange fires with (from, to) on a real transition only", () => {
  const m = new StateMachine();
  const seen = [];
  m.onChange = (from, to) => seen.push([from, to]);
  m.start(); // attract -> playing
  m.start(); // no-op, must NOT fire
  m.togglePause(); // playing -> paused
  assert.deepEqual(seen, [
    [GameState.ATTRACT, GameState.PLAYING],
    [GameState.PLAYING, GameState.PAUSED],
  ]);
});

// --- Unknown / invalid transitions are rejected, not thrown -------------------

test("states: an unknown target via set() is rejected and leaves state intact", () => {
  const m = new StateMachine({ initial: GameState.PLAYING });
  assert.throws(() => m.set("not-a-state"));
  assert.equal(m.state, GameState.PLAYING);
});

export default null;
