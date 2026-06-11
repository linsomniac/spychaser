// test/separation.test.js
//
// Unified vehicle overlap resolution (spec 2026-06-10 §4.1). Pure geometry, NO
// RNG: lateral hard de-penetration with a movability model — movable bodies are
// pushed apart, an immovable body (player/van) pushes movable bodies fully out,
// and two immovable bodies are left untouched (the van-ramp invariant).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOverlaps } from "../src/systems/separation.js";

/** A minimal vehicle body. */
function body(x, y, width = 40, height = 60) {
  return { x, y, width, height };
}

const MX = 6, MY = 8;
const opts = (over = {}) => ({ marginX: MX, marginY: MY, ...over });

test("two overlapping movable bodies split apart to a marginX gap", () => {
  const a = body(100, 100);
  const b = body(100, 100); // exactly stacked
  resolveOverlaps([a, b], opts());
  // Gap between near edges == marginX.
  const gap = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  assert.ok(Math.abs(gap - MX) < 1e-9, `gap ${gap} != marginX ${MX}`);
  assert.ok(a.x < b.x, "lower index goes left on an exact tie");
});

test("an asymmetric movable/movable overlap splits in the correct direction", () => {
  const left = body(100, 100);
  const right = body(110, 100); // overlapping, right is at higher x
  resolveOverlaps([left, right], opts());
  // The higher-x body must move further right, the lower-x body further left.
  assert.ok(right.x > 110, "right body pushed right");
  assert.ok(left.x < 100, "left body pushed left");
  // Settles to a marginX edge gap.
  const gap = Math.abs(right.x - left.x) - (left.width + right.width) / 2;
  assert.ok(Math.abs(gap - MX) < 1e-9, `gap ${gap} != marginX ${MX}`);
});

test("an immovable body pushes a movable body fully out and does not move", () => {
  const player = body(100, 100);
  const enemy = body(100, 100);
  resolveOverlaps([player, enemy], opts({ immovable: (e) => e === player }));
  assert.equal(player.x, 100, "immovable body never moves");
  assert.ok(Math.abs(enemy.x - player.x) >= (player.width + enemy.width) / 2, "enemy pushed clear");
});

test("two immovable bodies overlapping are left untouched (ramp invariant)", () => {
  const player = body(100, 100);
  const van = body(100, 100, 64, 104);
  resolveOverlaps([player, van], opts({ immovable: () => true }));
  assert.equal(player.x, 100);
  assert.equal(van.x, 100);
});

test("a custom clampX is applied to pushed positions", () => {
  const a = body(100, 100);
  const b = body(100, 100);
  resolveOverlaps([a, b], opts({ clampX: () => 50 }));
  assert.equal(a.x, 50);
  assert.equal(b.x, 50);
});

test("bodies clear of each other in y are not separated", () => {
  const a = body(100, 0);
  const b = body(100, 500); // far apart vertically
  resolveOverlaps([a, b], opts());
  assert.equal(a.x, 100);
  assert.equal(b.x, 100);
});
