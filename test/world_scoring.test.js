// test/world_scoring.test.js
//
// Phase 10 — scoring/lives integration into core/world.js. These exercise the
// full loop THROUGH the world (not just the Scoring unit): kills/distance feed
// the score, crossing the threshold in-window banks spare cars, harming a
// civilian penalizes + suspends the bonus, and running out of cars ends the run.
// The world runs headless with an explicit seed and no localStorage backend.

import { test } from "node:test";
import assert from "node:assert/strict";

import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { createEnemy } from "../src/entities/enemies.js";
import { Civilian } from "../src/entities/civilian.js";

const dt = config.FIXED_STEP;

// A world with no high-score persistence (headless) and a fixed seed.
function freshWorld(seed = 7) {
  return new World({ seed, storage: null });
}

test("world: exposes scoring state (cars, hiScore, bonusActive) via the Scoring system", () => {
  const w = freshWorld();
  assert.equal(w.cars, config.scoring.startCars);
  assert.equal(w.hiScore, 0);
  assert.equal(w.scoring.bonusActive, true, "bonus window open at the start");
  assert.equal(w.state, "playing");
});

test("world: distance accrues score over time (fractionally, integer-valued)", () => {
  const w = freshWorld();
  // Many ticks so the sub-point distance dribble folds whole points into score.
  for (let i = 0; i < 600; i++) w.update(dt);
  assert.ok(w.score > 0, "distance traveled has scored some points");
  assert.equal(w.score, Math.floor(w.score), "score stays integer-valued");
});

test("world: a kill routes through Scoring and adds the enemy's value", () => {
  const w = freshWorld();
  const enemy = createEnemy("switchblade", w.player.x, { config });
  enemy.y = w.player.y - 100;
  enemy.hp = 1;
  w.enemies.push(enemy);
  w.projectiles.spawn({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, ttl: 5 });
  const score0 = w.score;
  w.update(dt);
  assert.equal(enemy.dead, true);
  assert.equal(w.score, score0 + config.enemies.switchblade.scoreValue);
});

test("world: crossing the bonus threshold in-window banks spare cars (once)", () => {
  const w = freshWorld();
  const cars0 = w.cars;
  assert.equal(w.scoring.bonusActive, true);
  // Stage the score just below the threshold, then a kill pushes it over.
  w.scoring.score = config.scoring.bonusThreshold - 1;
  const enemy = createEnemy("switchblade", w.player.x, { config });
  enemy.y = w.player.y - 100;
  enemy.hp = 1;
  w.enemies.push(enemy);
  w.projectiles.spawn({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, ttl: 5 });
  w.update(dt);
  assert.equal(w.cars, cars0 + config.scoring.bonusSpareCars, "spare cars banked");
  assert.equal(w.scoring.banked, true);
});

test("world: shooting a civilian penalizes the score AND suspends the bonus", () => {
  const w = freshWorld();
  w.scoring.score = 1000;
  assert.equal(w.scoring.bonusActive, true, "bonus active before harm");
  const civ = new Civilian(w.player.x, w.player.x, { config });
  civ.y = w.player.y - 80;
  w.civilians.push(civ);
  w.projectiles.spawn({ x: civ.x, y: civ.y, vx: 0, vy: 0, ttl: 5 });
  w.update(dt);
  assert.equal(w.civilianHits, 1);
  assert.equal(w.score, 1000 - config.civilians.scorePenalty);
  assert.equal(w.scoring.bonusSuspended, true, "bonus suspended by civilian harm");
  assert.equal(w.scoring.bonusActive, false, "no more free replacements");
});

test("world: a crash inside the bonus window is FREE and respawns the car", () => {
  const w = freshWorld();
  const cars0 = w.cars;
  assert.equal(w.scoring.bonusActive, true);
  w.player.crashed = true; // simulate a wreck this tick
  w.update(dt);
  assert.equal(w.cars, cars0, "no spare car spent during the bonus window");
  assert.equal(w.player.crashed, false, "the car was respawned");
  assert.equal(w.state, "playing");
});

test("world: after the window, each crash costs a car and the run ends at zero", () => {
  const w = freshWorld();
  // Suspend the bonus so wrecks cost cars immediately (faster than timing out).
  w.scoring.bonusSuspended = true;
  const start = w.cars;
  for (let i = 0; i < start; i++) {
    assert.equal(w.state, "playing", "still playing while cars remain");
    w.player.crashed = true;
    w.update(dt);
  }
  assert.equal(w.cars, 0);
  assert.equal(w.scoring.gameOver, true);
  assert.equal(w.state, "gameover", "world flips to gameover at zero cars");
});

test("world: once game over, further updates are a no-op (frozen state)", () => {
  const w = freshWorld();
  w.scoring.bonusSuspended = true;
  for (let i = 0; i < config.scoring.startCars; i++) {
    w.player.crashed = true;
    w.update(dt);
  }
  assert.equal(w.state, "gameover");
  const ticks0 = w.ticks;
  const score0 = w.score;
  w.update(dt);
  assert.equal(w.ticks, ticks0, "no further ticks once game over");
  assert.equal(w.score, score0, "score frozen once game over");
});

test("world: a single wreck registers exactly once (crashed latches, no double-charge)", () => {
  const w = freshWorld();
  w.scoring.bonusSuspended = true;
  const cars0 = w.cars;
  // Force the crashed flag to persist across two ticks by re-asserting it after
  // the respawn so we can confirm only the rising edge charged a car.
  w.player.crashed = true;
  w.update(dt); // rising edge -> charges one car, respawns
  assert.equal(w.cars, cars0 - 1, "one car spent on the wreck");
  // The car was respawned (crashed=false); a quiet tick must not charge again.
  w.update(dt);
  assert.equal(w.cars, cars0 - 1, "no double-charge on the following tick");
});

test("world: reset restores a fresh scoring run (cars, score, bonus, state)", () => {
  const w = freshWorld();
  w.scoring.bonusSuspended = true;
  w.scoring.score = 5000;
  w.player.crashed = true;
  w.update(dt);
  w.reset();
  assert.equal(w.score, 0);
  assert.equal(w.civilianHits, 0);
  assert.equal(w.cars, config.scoring.startCars);
  assert.equal(w.scoring.bonusActive, true, "fresh bonus window after reset");
  assert.equal(w.scoring.banked, false);
  assert.equal(w.state, "playing");
});

test("world: high score is loaded from an injected storage backend", () => {
  // Minimal Web Storage stand-in seeded with a prior best.
  const map = new Map([["spychaser.hiscore", "4321"]]);
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const w = new World({ seed: 1, storage });
  assert.equal(w.hiScore, 4321, "world loads the persisted high score on init");
});

test("world: ending a run persists a new high score to storage", () => {
  const map = new Map([["spychaser.hiscore", "100"]]);
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const w = new World({ seed: 1, storage });
  w.scoring.bonusSuspended = true;
  w.scoring.score = 7777;
  for (let i = 0; i < config.scoring.startCars; i++) {
    w.player.crashed = true;
    w.update(dt);
  }
  assert.equal(w.state, "gameover");
  assert.equal(map.get("spychaser.hiscore"), "7777", "new record persisted on game over");
});

export default null;

// --- Regression M3: the run-ending tick's points reach the persisted high score
// Bug: _endRun() saved the high score from _handleCrash (mid-tick) BEFORE that
// same tick's distance/kills were credited, so final-tick points were lost from
// localStorage even though the game-over panel showed them. Fix: save at the END
// of the ending tick.
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test("world: the run-ending tick's kill is included in the saved high score (M3)", () => {
  const store = memStorage();
  const w = new World({ seed: 3, storage: store });
  w.director.update = () => [];
  // Arrange a guaranteed game-over wreck this tick: last car + bonus window over.
  w.scoring.cars = 1;
  w.scoring.bonusRemaining = 0;
  // A killable enemy with a bullet on top of it -> the kill scores THIS tick,
  // during collision resolution (which runs AFTER the crash/_endRun check).
  const e = createEnemy("switchblade", w.player.x, { config });
  e.y = w.player.y - 80;
  e.hp = 1;
  w.enemies.push(e);
  w.projectiles.spawn({ x: e.x, y: e.y, vx: 0, vy: 0, ttl: 5 });
  // Force the run to end this tick.
  w.player.crashed = true;
  w.update(dt);

  assert.equal(w.state, "gameover");
  assert.ok(
    w.score >= config.enemies.switchblade.scoreValue,
    "the final-tick kill scored",
  );
  // A fresh world reading the same storage must see the FULL final score.
  const reloaded = new World({ seed: 1, storage: store });
  assert.equal(
    reloaded.scoring.hiScore,
    w.score,
    "persisted high score includes the run-ending tick's points",
  );
});
