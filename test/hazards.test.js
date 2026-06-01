// test/hazards.test.js
//
// Pure-logic coverage for deployed field hazards (oil slick / smoke screen) and
// their collision hooks against pursuing enemies. Oil spins out; smoke blinds.
import test from "node:test";
import assert from "node:assert/strict";
import {
  Hazard,
  createHazard,
  tickHazard,
  applyHazardToEnemy,
} from "../src/entities/hazards.js";
import { createEnemy } from "../src/entities/enemies.js";

test("createHazard returns an alive hazard with an AABB footprint", () => {
  const h = createHazard("oil", 50, 60);
  assert.ok(h instanceof Hazard);
  assert.equal(h.kind, "oil");
  assert.equal(h.active, true);
  assert.ok(h.width > 0 && h.height > 0);
  assert.ok(h.life > 0);
  // Centered on the spawn point; bounds are top-left.
  assert.equal(h.bounds.x, 50 - h.width / 2);
});

test("createHazard throws on unknown kind", () => {
  assert.throws(() => createHazard("lava", 0, 0));
});

test("tickHazard ages the hazard and scrolls it down with the road", () => {
  const h = createHazard("oil", 0, 0);
  const life0 = h.life;
  tickHazard(h, 1 / 60, 260); // dt, scrollSpeed px/s
  assert.ok(h.life < life0);
  assert.ok(h.y > 0, "hazard scrolls downward with road speed");
});

test("tickHazard deactivates the hazard when life runs out", () => {
  const h = createHazard("smoke", 0, 0);
  h.life = 0.01;
  tickHazard(h, 1 / 60, 0);
  assert.equal(h.active, false);
});

test("oil hazard spins out an enemy that touches it", () => {
  const h = createHazard("oil", 100, 100);
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  const hit = applyHazardToEnemy(h, e);
  assert.equal(hit, true);
  assert.ok(e.spinTimer > 0, "enemy is spinning out");
});

test("smoke hazard blinds an enemy that touches it", () => {
  const h = createHazard("smoke", 100, 100);
  const e = createEnemy("roadLord", 100);
  e.y = 100;
  const hit = applyHazardToEnemy(h, e);
  assert.equal(hit, true);
  assert.ok(e.blindTimer > 0, "enemy is blinded");
});

test("hazard misses a distant enemy", () => {
  const h = createHazard("oil", 0, 0);
  const e = createEnemy("switchblade", 1000);
  e.y = 1000;
  assert.equal(applyHazardToEnemy(h, e), false);
  assert.equal(e.spinTimer, 0);
});

test("an inactive hazard never affects enemies", () => {
  const h = createHazard("oil", 100, 100);
  h.active = false;
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  assert.equal(applyHazardToEnemy(h, e), false);
});

test("a dead enemy is not affected by hazards", () => {
  const h = createHazard("oil", 100, 100);
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  e.active = false;
  assert.equal(applyHazardToEnemy(h, e), false);
});

test("a spun-out enemy stops steering toward the player", () => {
  // Integration: oil hazard -> enemy.spinTimer -> base update() drifts, no steer.
  const h = createHazard("oil", 100, 100);
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  applyHazardToEnemy(h, e);
  const xBefore = e.x;
  // Player is far to the right; a non-spinning enemy would steer toward it.
  e.update(1 / 60, { player: { x: 500, y: 600 } });
  assert.equal(e.x, xBefore, "spun-out enemy does not steer laterally");
});

test("a blinded enemy stops tracking the player's lane", () => {
  const h = createHazard("smoke", 100, 100);
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  applyHazardToEnemy(h, e);
  const xBefore = e.x;
  e.update(1 / 60, { player: { x: 500, y: 600 } });
  assert.equal(e.x, xBefore, "blinded enemy does not track the player");
});

test("hazard effect timers count down and expire over time", () => {
  const e = createEnemy("switchblade", 100);
  e.y = 100;
  const h = createHazard("oil", 100, 100);
  applyHazardToEnemy(h, e);
  const t0 = e.spinTimer;
  e.update(1 / 60, { player: { x: 100, y: 600 } });
  assert.ok(e.spinTimer < t0, "spin timer decays each update");
});
