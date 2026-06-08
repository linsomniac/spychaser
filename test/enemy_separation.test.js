// test/enemy_separation.test.js
//
// Soft separation (spec §4.3): a pure-geometry, RNG-free pass nudges enemies
// apart so they never sit directly stacked, while still allowing side-by-side
// flanking. Tested directly on the pure function (no world, no steering).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnemy, separateEnemies } from "../src/entities/enemies.js";
import { config } from "../src/data/config.js";

const SEP = config.enemies.separation;
const DT = 1 / 60;

function stacked() {
  const a = createEnemy("switchblade", 270, {});
  const b = createEnemy("switchblade", 270, {});
  a.y = 100;
  b.y = 100; // identical position => maximal overlap
  return [a, b];
}

test("two stacked enemies diverge to a non-overlapping gap within a couple seconds", () => {
  const [a, b] = stacked();
  const clearGap = (a.width + b.width) / 2 + SEP.marginX;
  let ticks = 0;
  while (Math.abs(a.x - b.x) < clearGap && ticks < 240) {
    separateEnemies([a, b], DT, { config });
    ticks++;
  }
  assert.ok(Math.abs(a.x - b.x) >= clearGap, `still stacked after ${ticks} ticks`);
});

test("separation is index-deterministic: equal-x pair, lower index goes left", () => {
  const [a, b] = stacked();
  separateEnemies([a, b], DT, { config });
  assert.ok(a.x < b.x, "index 0 should be pushed left of index 1");
});

test("enemies far apart in y are untouched (no false separation)", () => {
  const a = createEnemy("switchblade", 270, {});
  const b = createEnemy("switchblade", 270, {});
  a.y = 0;
  b.y = 500;
  const ax = a.x, bx = b.x;
  separateEnemies([a, b], DT, { config });
  assert.equal(a.x, ax);
  assert.equal(b.x, bx);
});

test("a custom clampX is applied to the pushed positions", () => {
  const [a, b] = stacked();
  // Clamp everything to a tiny band so the push can't move anything.
  separateEnemies([a, b], DT, { config, clampX: () => 270 });
  assert.equal(a.x, 270);
  assert.equal(b.x, 270);
});
