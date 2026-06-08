// test/world_ricochet.test.js
//
// Ricochet feedback (spec §4.6): a plain bullet hitting the bulletproof Enforcer
// emits a "ricochet" cue (and is still consumed); a plain bullet overlapping the
// immune helicopter emits a ricochet cue but is NOT consumed and does NO damage
// (preserving the missile-only pass-through contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { createEnemy, HELI_PHASE } from "../src/entities/enemies.js";

const DT = config.FIXED_STEP;

test("a bullet on the bulletproof Enforcer ricochets (cue emitted, bullet consumed)", () => {
  const w = new World({ seed: 1 });
  const e = createEnemy("enforcer", w.player.x, { config: w.config });
  e.y = 200;
  w.enemies.push(e);
  w.projectiles.spawn({
    x: e.x, y: 200, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5,
  });
  w.update(DT);
  assert.ok(w.audioEvents.some((a) => a.type === "ricochet"), "ricochet cue emitted");
  assert.equal(w.projectiles.toArray().length, 0, "bullet consumed");
  assert.equal(e.dead, false, "bulletproof Enforcer unharmed");
});

test("a plain bullet on the helicopter ricochets but is NOT consumed / no damage", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  w._heliRicochetCd = 0; // ensure not throttled this tick
  const b = w.projectiles.spawn({
    x: h.x, y: h.y, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5,
  });
  w.update(DT);
  assert.ok(w.audioEvents.some((a) => a.type === "ricochet"), "ricochet cue emitted");
  assert.equal(b.active, true, "bullet passes through (not consumed)");
  assert.equal(h.hp, config.helicopter.hp, "heli takes no damage from bullets");
});

test("the helicopter ricochet cue is throttled within ricochetInterval", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  w._heliRicochetCd = 0;
  w.projectiles.spawn({ x: h.x, y: h.y, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5 });
  w.update(DT);
  assert.ok(
    w.audioEvents.filter((a) => a.type === "ricochet").length >= 1,
    "first overlapping bullet emits a ricochet",
  );
  // Within the throttle window (_heliRicochetCd still > 0 after one DT), a second
  // overlapping bullet must NOT add a cue.
  w.audioEvents = []; // observe only the next tick's events
  w.projectiles.spawn({ x: h.x, y: h.y, vx: 0, vy: 0, category: "playerBullet", damage: 1, ttl: 5 });
  w.update(DT);
  assert.equal(
    w.audioEvents.filter((a) => a.type === "ricochet").length,
    0,
    "second bullet within the throttle window is suppressed",
  );
});
