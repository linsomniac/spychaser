// test/scoring.test.js
//
// Phase 10 — scoring, lives & the bonus-time mechanic. Test-first per the plan.
// These lock in the PURE scoring/lives logic, decoupled from canvas/raf/Web Audio
// (spec §5): score events (kills, distance, no-civilian-harm bonus), the
// bonus-time window with FREE wreck replacements, the score-threshold -> bank
// spare cars rule, the civilian penalty + bonus suspension, and the lives state
// machine that ends the game at zero cars. localStorage high-score persistence is
// covered with an injected stub so it stays headless.

import test from "node:test";
import assert from "node:assert/strict";

import { Scoring } from "../src/systems/scoring.js";
import { config } from "../src/data/config.js";

const dt = config.FIXED_STEP;
const SC = config.scoring;

// A tiny in-memory localStorage stand-in (the Node test runner has no DOM).
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// --- Initial state ------------------------------------------------------------

test("Scoring: starts at zero score with the configured starting cars", () => {
  const s = new Scoring();
  assert.equal(s.score, 0);
  assert.equal(s.civilianHits, 0);
  assert.equal(s.cars, SC.startCars);
  assert.equal(s.gameOver, false);
});

test("Scoring: the bonus-time window is active at the start of a run", () => {
  const s = new Scoring();
  assert.equal(s.bonusActive, true, "free-replacement window open at start");
  assert.ok(s.bonusRemaining > 0, "time remaining in the window");
  assert.ok(Math.abs(s.bonusRemaining - SC.bonusWindow) < 1e-9);
  assert.equal(s.bonusSuspended, false);
});

// --- Score events -------------------------------------------------------------

test("Scoring: addKill adds the enemy's point value", () => {
  const s = new Scoring();
  s.addKill(100);
  s.addKill(250);
  assert.equal(s.score, 350);
});

test("Scoring: addDistance accrues points per virtual px traveled", () => {
  const s = new Scoring();
  s.addDistance(1000);
  assert.ok(Math.abs(s.score - 1000 * SC.distanceScorePerPx) < 1e-9);
});

test("Scoring: addDistance ignores non-positive deltas (no rewind points)", () => {
  const s = new Scoring();
  s.addDistance(-500);
  s.addDistance(0);
  assert.equal(s.score, 0);
});

// --- Bonus-time window: expiry ------------------------------------------------

test("Scoring: the bonus window expires after bonusWindow seconds", () => {
  const s = new Scoring();
  const steps = Math.ceil(SC.bonusWindow / dt) + 2;
  for (let i = 0; i < steps; i++) s.update(dt);
  assert.equal(s.bonusActive, false, "window closed after its duration");
  assert.equal(s.bonusRemaining, 0);
});

test("Scoring: the window is still open one step before it would expire", () => {
  const s = new Scoring();
  const steps = Math.floor(SC.bonusWindow / dt) - 1;
  for (let i = 0; i < steps; i++) s.update(dt);
  assert.equal(s.bonusActive, true, "still inside the window");
  assert.ok(s.bonusRemaining > 0);
});

// --- Bonus-time window: free wreck replacement --------------------------------

test("Scoring: during the bonus window a wreck is replaced for FREE (no car lost)", () => {
  const s = new Scoring();
  const cars0 = s.cars;
  const cost = s.loseCar();
  assert.equal(cost, false, "loseCar returns false => no car consumed");
  assert.equal(s.cars, cars0, "car count unchanged during the window");
  assert.equal(s.gameOver, false);
});

test("Scoring: after the window each wreck costs a car", () => {
  const s = new Scoring();
  // Run the window out.
  const steps = Math.ceil(SC.bonusWindow / dt) + 2;
  for (let i = 0; i < steps; i++) s.update(dt);
  const cars0 = s.cars;
  const cost = s.loseCar();
  assert.equal(cost, true, "loseCar consumes a car after the window");
  assert.equal(s.cars, cars0 - 1);
});

// --- Score-threshold banking --------------------------------------------------

test("Scoring: crossing the threshold during the window banks spare cars once", () => {
  const s = new Scoring();
  const cars0 = s.cars;
  s.addKill(SC.bonusThreshold); // crosses the threshold in one event
  assert.equal(s.cars, cars0 + SC.bonusSpareCars, "spare cars banked");
  assert.equal(s.banked, true);
  // Crossing again (more points) does not bank a second time.
  s.addKill(SC.bonusThreshold);
  assert.equal(s.cars, cars0 + SC.bonusSpareCars, "banked only once");
});

test("Scoring: distance points can also cross the banking threshold", () => {
  const s = new Scoring();
  const cars0 = s.cars;
  // Enough distance to exceed the threshold.
  const px = (SC.bonusThreshold + 1) / SC.distanceScorePerPx;
  s.addDistance(px);
  assert.equal(s.cars, cars0 + SC.bonusSpareCars);
  assert.equal(s.banked, true);
});

test("Scoring: reaching the threshold AFTER the window does NOT bank cars", () => {
  const s = new Scoring();
  const steps = Math.ceil(SC.bonusWindow / dt) + 2;
  for (let i = 0; i < steps; i++) s.update(dt);
  const cars0 = s.cars;
  s.addKill(SC.bonusThreshold);
  assert.equal(s.cars, cars0, "no banking once the window has closed");
  assert.equal(s.banked, false);
});

// --- Civilian penalty + bonus suspension --------------------------------------

test("Scoring: a civilian hit subtracts the penalty and counts the hit", () => {
  const s = new Scoring();
  s.addKill(1000);
  s.civilianPenalty(300);
  assert.equal(s.score, 700);
  assert.equal(s.civilianHits, 1);
});

test("Scoring: the score never goes negative on a civilian penalty", () => {
  const s = new Scoring();
  s.addKill(50);
  s.civilianPenalty(300);
  assert.equal(s.score, 0);
});

test("Scoring: harming a civilian SUSPENDS the bonus (free replacement revoked)", () => {
  const s = new Scoring();
  assert.equal(s.bonusActive, true);
  s.civilianPenalty(300);
  assert.equal(s.bonusSuspended, true, "bonus suspended after civilian harm");
  // bonusActive folds in the suspension: no longer granting free replacements.
  assert.equal(s.bonusActive, false, "suspended window grants no free replacements");
  // A wreck now costs a car even though the timer has not run out.
  const cars0 = s.cars;
  const cost = s.loseCar();
  assert.equal(cost, true, "wreck costs a car once the bonus is suspended");
  assert.equal(s.cars, cars0 - 1);
});

test("Scoring: a suspended bonus cannot bank spare cars at the threshold", () => {
  const s = new Scoring();
  s.civilianPenalty(300); // suspends the bonus
  const cars0 = s.cars;
  s.addKill(SC.bonusThreshold);
  assert.equal(s.cars, cars0, "no banking while the bonus is suspended");
  assert.equal(s.banked, false);
});

// --- Lives state machine: game over at zero -----------------------------------

test("Scoring: the game ends when the last car is wrecked (zero cars)", () => {
  const s = new Scoring();
  // Close the window so wrecks cost cars.
  const steps = Math.ceil(SC.bonusWindow / dt) + 2;
  for (let i = 0; i < steps; i++) s.update(dt);
  // Burn through all spare cars.
  for (let i = 0; i < SC.startCars; i++) {
    assert.equal(s.gameOver, false, "still alive while cars remain");
    s.loseCar();
  }
  assert.equal(s.cars, 0);
  assert.equal(s.gameOver, true, "game over once cars hit zero");
});

test("Scoring: once game over, further loseCar calls do not go negative", () => {
  const s = new Scoring();
  const steps = Math.ceil(SC.bonusWindow / dt) + 2;
  for (let i = 0; i < steps; i++) s.update(dt);
  for (let i = 0; i < SC.startCars + 5; i++) s.loseCar();
  assert.equal(s.cars, 0, "cars floor at zero");
  assert.equal(s.gameOver, true);
});

// --- High-score persistence (localStorage, guarded) ---------------------------

test("Scoring: loadHighScore reads a stored high score from injected storage", () => {
  const store = makeStorage({ [Scoring.HISCORE_KEY]: "12345" });
  const s = new Scoring({ storage: store });
  s.loadHighScore();
  assert.equal(s.hiScore, 12345);
});

test("Scoring: loadHighScore defaults to 0 when nothing is stored", () => {
  const s = new Scoring({ storage: makeStorage() });
  s.loadHighScore();
  assert.equal(s.hiScore, 0);
});

test("Scoring: saveHighScore persists a NEW high score and updates hiScore", () => {
  const store = makeStorage({ [Scoring.HISCORE_KEY]: "1000" });
  const s = new Scoring({ storage: store });
  s.loadHighScore();
  s.addKill(5000);
  const saved = s.saveHighScore();
  assert.equal(saved, true, "a new record is saved");
  assert.equal(s.hiScore, 5000);
  assert.equal(store.getItem(Scoring.HISCORE_KEY), "5000");
});

test("Scoring: saveHighScore does NOT lower an existing higher record", () => {
  const store = makeStorage({ [Scoring.HISCORE_KEY]: "9000" });
  const s = new Scoring({ storage: store });
  s.loadHighScore();
  s.addKill(100);
  const saved = s.saveHighScore();
  assert.equal(saved, false, "lower score is not saved");
  assert.equal(s.hiScore, 9000);
  assert.equal(store.getItem(Scoring.HISCORE_KEY), "9000");
});

test("Scoring: high-score helpers are no-ops (never throw) without localStorage", () => {
  // No storage injected and no global localStorage in Node => must not throw.
  const s = new Scoring({ storage: null });
  s.loadHighScore(); // hiScore stays 0
  assert.equal(s.hiScore, 0);
  s.addKill(4242);
  assert.doesNotThrow(() => s.saveHighScore());
  // hiScore still tracks the in-memory best even with no backing store.
  assert.equal(s.hiScore, 4242);
});

// --- Reset --------------------------------------------------------------------

test("Scoring: reset restores a fresh run but KEEPS the loaded high score", () => {
  const store = makeStorage({ [Scoring.HISCORE_KEY]: "8000" });
  const s = new Scoring({ storage: store });
  s.loadHighScore();
  s.addKill(500);
  s.civilianPenalty(300);
  s.loseCar();
  s.update(dt);
  s.reset();
  assert.equal(s.score, 0);
  assert.equal(s.civilianHits, 0);
  assert.equal(s.cars, SC.startCars);
  assert.equal(s.bonusActive, true, "fresh bonus window after reset");
  assert.equal(s.bonusSuspended, false);
  assert.equal(s.banked, false);
  assert.equal(s.gameOver, false);
  assert.equal(s.hiScore, 8000, "high score survives a reset");
});

// --- Determinism --------------------------------------------------------------

test("Scoring: identical event sequences produce identical state (deterministic)", () => {
  function run() {
    const s = new Scoring({ storage: null });
    const out = [];
    for (let i = 0; i < 5000; i++) {
      if (i === 100) s.addKill(150);
      if (i === 200) s.addDistance(500);
      if (i === 1500) s.civilianPenalty(300);
      if (i === 3000) s.loseCar();
      s.update(dt);
      out.push([s.score, s.cars, s.bonusActive, s.gameOver]);
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

export default null;
