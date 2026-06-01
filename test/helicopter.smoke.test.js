// test/helicopter.smoke.test.js
// Phase 7 — module surface (no canvas / no DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as enemies from "../src/entities/enemies.js";
import * as collision from "../src/systems/collision.js";

test("enemies module exports the helicopter/bomb API", () => {
  assert.equal(typeof enemies.Helicopter, "function");
  assert.equal(typeof enemies.Bomb, "function");
  assert.ok(enemies.HELI_PHASE);
  assert.equal(typeof enemies.createEnemy, "function");
});

test("collision module exports the Phase 7 helpers", () => {
  assert.equal(typeof collision.resolveMissilesVsHelicopter, "function");
  assert.equal(typeof collision.resolveBombBlast, "function");
  assert.equal(typeof collision.circleOverlapsBounds, "function");
});
