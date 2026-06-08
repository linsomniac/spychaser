// test/world_heli_lifecycle.test.js
//
// Helicopter lifecycle wired into the World (spec §4.4): a retired heli starts a
// cooldown break during which a new "helicopter" milestone is a no-op; once the
// break elapses the next milestone spawns again. A waited-out heli scores zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { Helicopter, HELI_PHASE } from "../src/entities/enemies.js";

const H = config.helicopter;

test("retiring a heli starts a cooldown that blocks the next one, then allows it", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.ok(w.helicopter instanceof Helicopter);

  // Force it to LEAVING + off the top so the world retires it this tick.
  w.helicopter.phase = HELI_PHASE.LEAVING;
  w.helicopter.y = -H.height - 100;
  w.update(1 / 60);
  assert.equal(w.helicopter, null, "retired after leaving the screen");
  assert.ok(w._heliCooldown > 0, "cooldown armed on retire");

  // A milestone during the cooldown is dropped.
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.equal(w.helicopter, null, "cooldown blocks a fresh heli");

  // Once the break elapses, the next milestone spawns one.
  w._heliCooldown = 0;
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.ok(w.helicopter instanceof Helicopter, "spawns again after the cooldown");
});

test("a waited-out heli leaves alive and is never scored (dead stays false)", () => {
  const w = new World({ seed: 1 });
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  w.helicopter.y = H.hoverY;
  w.helicopter.phase = HELI_PHASE.TRACKING;
  let sawDead = false;
  let guard = 0;
  while (w.helicopter && guard < 4000) {
    w.update(1 / 60);
    if (w.helicopter) sawDead = sawDead || w.helicopter.dead;
    guard++;
  }
  assert.equal(w.helicopter, null, "heli eventually left and was retired");
  assert.equal(sawDead, false, "wait-out heli never marked dead => zero score path");
});

test("reset clears the heli cooldown", () => {
  const w = new World({ seed: 1 });
  w._heliCooldown = 99;
  w.reset();
  assert.equal(w._heliCooldown, 0);
});
