// test/civilian.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Civilian } from "../src/entities/civilian.js";
import { config } from "../src/data/config.js";
import { createRng } from "../src/engine/rng.js";
import { Road } from "../src/systems/road.js";

test("civilian initializes position, target and bounds", () => {
  const c = new Civilian(120, 150);
  assert.equal(c.type, "civilian");
  assert.equal(c.x, 120);
  assert.equal(c.targetX, 150);
  assert.equal(c.y, config.civilians.spawnY);
  assert.equal(c.active, true);
  const b = c.bounds;
  assert.equal(b.x, 120 - c.width / 2);
  assert.equal(b.w, c.width);
});

test("civilian cruises downward each tick", () => {
  const c = new Civilian(120, 120);
  const y0 = c.y;
  c.update(0.5);
  assert.equal(c.y, y0 + config.civilians.approachSpeed * 0.5);
});

test("civilian drifts toward target without overshoot", () => {
  const c = new Civilian(100, 200);
  c.update(0.1);
  assert.equal(c.x, 100 + config.civilians.driftSpeed * 0.1);
  const c2 = new Civilian(100, 102);
  c2.update(10); // big dt snaps exactly
  assert.equal(c2.x, 102);
});

test("civilian re-rolls drift target on the timer within road bounds", () => {
  const road = new Road({ seed: 7, config });
  const rng = createRng(11);
  const c = new Civilian(200, 200);
  // Advance past the drift interval so a new target is chosen.
  c.update(config.civilians.driftInterval + 0.01, { rng, road, distance: 0 });
  const dist = (config.VIRTUAL_HEIGHT - c.y);
  const s = road.sampleAt(dist);
  assert.ok(c.targetX >= s.leftEdge + c.width / 2 - 1e-6);
  assert.ok(c.targetX <= s.rightEdge - c.width / 2 + 1e-6);
});

test("drift re-roll is deterministic with a seeded rng", () => {
  const roadA = new Road({ seed: 3, config });
  const roadB = new Road({ seed: 3, config });
  const a = new Civilian(200, 200);
  const b = new Civilian(200, 200);
  const ra = createRng(99);
  const rb = createRng(99);
  for (let i = 0; i < 5; i++) {
    a.update(config.civilians.driftInterval + 0.01, { rng: ra, road: roadA, distance: 0 });
    b.update(config.civilians.driftInterval + 0.01, { rng: rb, road: roadB, distance: 0 });
  }
  assert.equal(a.targetX, b.targetX);
});

test("civilian update without rng/road still cruises (no crash)", () => {
  const c = new Civilian(100, 100);
  c.update(0.1); // no world
  assert.ok(c.y > config.civilians.spawnY);
});

test("isOffscreen detects pass-by-bottom", () => {
  const c = new Civilian(100, 100);
  c.y = config.VIRTUAL_HEIGHT + 200;
  assert.ok(c.isOffscreen(config.VIRTUAL_HEIGHT));
  c.y = 100;
  assert.ok(!c.isOffscreen(config.VIRTUAL_HEIGHT));
});
