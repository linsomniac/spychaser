// test/world_heli.test.js
//
// Phase 7 — the helicopter set-piece is wired into the World:
//   * a "helicopter" director set-piece spawns exactly one Helicopter,
//   * the heli updates each tick, drops bombs that fall and detonate,
//   * bullets never hurt it but missiles do, and a defeated heli is retired
//     once it flies off the top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { config } from "../src/data/config.js";
import { Helicopter, HELI_PHASE } from "../src/entities/enemies.js";

function newWorld() {
  return new World({ seed: 1234 });
}

test("a 'helicopter' set-piece trigger spawns exactly one Helicopter", () => {
  const w = newWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.ok(w.helicopter instanceof Helicopter, "heli spawned");
  // One-shot guard: a second trigger while one is live does not replace it.
  const first = w.helicopter;
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  assert.equal(w.helicopter, first, "no duplicate heli");
});

test("the live helicopter updates, reaches TRACKING and drops bombs into the world", () => {
  const w = newWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  // Place the heli already at its hover line so it tracks promptly.
  w.helicopter.y = config.helicopter.hoverY;
  let guard = 0;
  while (w.helicopter && w.helicopter.phase !== HELI_PHASE.TRACKING && guard < 2000) {
    w.update(1 / 60);
    guard++;
  }
  assert.equal(w.helicopter.phase, HELI_PHASE.TRACKING);
  const before = w.bombs.length;
  for (let i = 0; i < 200; i++) w.update(1 / 60);
  // Bombs were dropped at some point (some may have detonated and been culled),
  // so assert at least one is or was present.
  assert.ok(w.bombs.length > 0 || before > 0 || w._bombsDropped > 0, "bombs dropped");
});

test("machine-gun bullets never destroy the helicopter", () => {
  const w = newWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  // Fire a stream of bullets straight at the heli for many ticks.
  for (let i = 0; i < 120; i++) {
    w.projectiles.spawn({
      x: h.x,
      y: h.y,
      vx: 0,
      vy: 0,
      category: "playerBullet",
      damage: 1,
      ttl: 5,
    });
    w.update(1 / 60);
    if (!w.helicopter) break;
  }
  assert.ok(w.helicopter, "heli survived the bullet storm");
  assert.equal(w.helicopter.dead, false);
});

test("missiles destroy the helicopter and it is eventually retired", () => {
  const w = newWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  const h = w.helicopter;
  h.y = config.helicopter.hoverY;
  h.phase = HELI_PHASE.TRACKING;
  // Hit it with hp missiles.
  for (let i = 0; i < config.helicopter.hp; i++) {
    w.projectiles.spawn({
      x: h.x,
      y: h.y,
      vx: 0,
      vy: 0,
      category: "playerMissile",
      kind: "missile",
      damage: 1,
      ttl: 5,
      w: 8,
      h: 20,
    });
    w.update(1 / 60);
  }
  assert.equal(h.dead, true, "destroyed by missiles");
  // Let it fly off the top; the world should clear the reference.
  let guard = 0;
  while (w.helicopter && guard < 2000) {
    w.update(1 / 60);
    guard++;
  }
  assert.equal(w.helicopter, null, "retired after leaving the screen");
});

test("reset clears any helicopter and bombs", () => {
  const w = newWorld();
  w._realizeSpawn({ kind: "setpiece", name: "helicopter" });
  w.bombs.push({});
  w.reset();
  assert.equal(w.helicopter, null);
  assert.equal(w.bombs.length, 0);
});
