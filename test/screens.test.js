// test/screens.test.js
//
// Phase 11 — the screen/overlay layer. The DRAWING in render/screens.js touches
// Canvas 2D only, but the PURE decision/formatting logic — which overlay to show
// for a given game-flow state, and the game-over summary lines (score, hi-score,
// NEW RECORD flag) — is factored into exported free functions and unit-tested
// here headlessly (spec §5: keep logic out of the canvas layer; mirrors how
// render/hud.js is structured + tested).

import test from "node:test";
import assert from "node:assert/strict";

import { overlayForState, gameOverSummary } from "../src/render/screens.js";
import { GameState } from "../src/core/states.js";

// --- overlayForState: maps a game-flow state to the overlay to draw -----------

test("screens: ATTRACT shows the title overlay", () => {
  assert.equal(overlayForState(GameState.ATTRACT), "title");
});

test("screens: PLAYING shows no overlay (clean play field)", () => {
  assert.equal(overlayForState(GameState.PLAYING), null);
});

test("screens: PAUSED shows the pause overlay", () => {
  assert.equal(overlayForState(GameState.PAUSED), "pause");
});

test("screens: GAME_OVER shows the game-over overlay", () => {
  assert.equal(overlayForState(GameState.GAME_OVER), "gameover");
});

test("screens: an unknown state shows no overlay (fail safe, no throw)", () => {
  assert.equal(overlayForState("???"), null);
  assert.equal(overlayForState(undefined), null);
});

// --- gameOverSummary: the lines the game-over panel renders -------------------

test("screens: game-over summary reports score and hi-score", () => {
  const s = gameOverSummary({ score: 1234, hiScore: 9999 });
  assert.equal(s.score, "001,234");
  assert.equal(s.hiScore, "009,999");
});

test("screens: a new record is flagged when score >= hi-score and > 0", () => {
  const s = gameOverSummary({ score: 5000, hiScore: 5000 });
  assert.equal(s.newRecord, true);
});

test("screens: a non-record score is not flagged", () => {
  const s = gameOverSummary({ score: 100, hiScore: 5000 });
  assert.equal(s.newRecord, false);
});

test("screens: a zero score is never a record (cold-start guard)", () => {
  const s = gameOverSummary({ score: 0, hiScore: 0 });
  assert.equal(s.newRecord, false);
});

test("screens: summary tolerates missing fields (defaults to 0)", () => {
  const s = gameOverSummary({});
  assert.equal(s.score, "000,000");
  assert.equal(s.hiScore, "000,000");
  assert.equal(s.newRecord, false);
});

export default null;
