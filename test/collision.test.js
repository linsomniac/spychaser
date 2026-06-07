// test/collision.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aabbOverlap, boundsOverlap, collidePairs } from "../src/systems/collision.js";

// AABB helper used throughout: {x, y, w, h} where (x,y) is the top-left corner.
function box(x, y, w, h) {
  return { x, y, w, h };
}

// A tiny entity wrapper exposing a `bounds` accessor (the collision contract).
function entity(x, y, w, h, extra = {}) {
  return { bounds: box(x, y, w, h), ...extra };
}

test("aabbOverlap: clearly overlapping boxes overlap", () => {
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(5, 5, 10, 10)), true);
});

test("aabbOverlap: clearly separated boxes do not overlap", () => {
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(100, 100, 10, 10)), false);
});

test("aabbOverlap: separated only on X does not overlap", () => {
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(20, 5, 10, 10)), false);
});

test("aabbOverlap: separated only on Y does not overlap", () => {
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(5, 20, 10, 10)), false);
});

test("aabbOverlap: edge-touching boxes (shared edge) do NOT overlap", () => {
  // Right edge of A (x=10) meets left edge of B (x=10): touching, not overlapping.
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(10, 0, 10, 10)), false);
  // Same on the Y axis.
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(0, 10, 10, 10)), false);
});

test("aabbOverlap: one box fully containing another overlaps", () => {
  assert.equal(aabbOverlap(box(0, 0, 100, 100), box(40, 40, 10, 10)), true);
});

test("aabbOverlap: 1px overlap counts as overlapping", () => {
  assert.equal(aabbOverlap(box(0, 0, 10, 10), box(9, 0, 10, 10)), true);
});

test("boundsOverlap: reads .bounds from entities", () => {
  const a = entity(0, 0, 10, 10);
  const b = entity(5, 5, 10, 10);
  const c = entity(100, 100, 10, 10);
  assert.equal(boundsOverlap(a, b), true);
  assert.equal(boundsOverlap(a, c), false);
});

test("collidePairs: reports each overlapping (a,b) pair once", () => {
  const groupA = [entity(0, 0, 10, 10, { id: "a0" }), entity(50, 50, 10, 10, { id: "a1" })];
  const groupB = [entity(5, 5, 10, 10, { id: "b0" }), entity(200, 200, 10, 10, { id: "b1" })];
  const hits = [];
  collidePairs(groupA, groupB, (a, b) => hits.push([a.id, b.id]));
  assert.deepEqual(hits, [["a0", "b0"]]);
});

test("collidePairs: no pairs when nothing overlaps", () => {
  const groupA = [entity(0, 0, 10, 10)];
  const groupB = [entity(500, 500, 10, 10)];
  let count = 0;
  collidePairs(groupA, groupB, () => count++);
  assert.equal(count, 0);
});

test("collidePairs: handles many-to-many overlaps", () => {
  // Two A boxes both overlap the same big B box.
  const groupA = [entity(0, 0, 10, 10, { id: "a0" }), entity(20, 20, 10, 10, { id: "a1" })];
  const groupB = [entity(0, 0, 100, 100, { id: "big" })];
  const hits = [];
  collidePairs(groupA, groupB, (a, b) => hits.push([a.id, b.id]));
  assert.deepEqual(hits.sort(), [["a0", "big"], ["a1", "big"]]);
});

test("collidePairs: category filtering skips disallowed pairs", () => {
  // Player bullets should hit enemies but never civilians.
  const bullet = entity(0, 0, 6, 16, { category: "playerBullet" });
  const enemy = entity(0, 0, 36, 64, { category: "enemy" });
  const civilian = entity(0, 0, 36, 64, { category: "civilian" });
  const groupA = [bullet];
  const groupB = [enemy, civilian];
  // Filter: only allow playerBullet vs enemy.
  const filter = (a, b) => a.category === "playerBullet" && b.category === "enemy";
  const hits = [];
  collidePairs(groupA, groupB, (a, b) => hits.push(b.category), filter);
  assert.deepEqual(hits, ["enemy"]);
});

test("collidePairs: inactive entities (active === false) are skipped", () => {
  const groupA = [entity(0, 0, 10, 10, { active: false }), entity(0, 0, 10, 10, { active: true, id: "live" })];
  const groupB = [entity(0, 0, 10, 10, { active: true, id: "target" })];
  const hits = [];
  collidePairs(groupA, groupB, (a, b) => hits.push([a.id, b.id]));
  assert.deepEqual(hits, [["live", "target"]]);
});

test("collidePairs: callback returning true stops further pairing for that A", () => {
  // A bullet that hits one enemy is consumed and should not hit a second.
  const bullet = entity(0, 0, 10, 10, { id: "b" });
  const groupA = [bullet];
  const groupB = [entity(0, 0, 10, 10, { id: "e0" }), entity(2, 2, 10, 10, { id: "e1" })];
  const hits = [];
  collidePairs(groupA, groupB, (a, b) => {
    hits.push(b.id);
    return true; // consume after first hit
  });
  assert.deepEqual(hits, ["e0"]);
});

// --- Regression: in-loop swap-removal of a consumed groupA element ------------
// onHit consuming `a` often despawns it via a pool kill() that swap-removes the
// element from the SAME array collidePairs is iterating (Projectiles.toArray()
// returns the live array). collidePairs must not skip the element swapped into
// the just-vacated slot.
test("collidePairs: swap-removing a consumed element skips nothing", () => {
  // Two bullets, each overlapping its own target so both should register a hit.
  const groupA = [entity(0, 0, 10, 10, { id: "b1" }), entity(0, 0, 10, 10, { id: "b2" })];
  const groupB = [entity(0, 0, 10, 10, { id: "t" })];
  const hitIds = [];
  collidePairs(groupA, groupB, (a) => {
    hitIds.push(a.id);
    // Simulate Projectiles.kill(): swap-with-last removal of `a` from groupA.
    const i = groupA.indexOf(a);
    const last = groupA.length - 1;
    if (i !== last) groupA[i] = groupA[last];
    groupA.pop();
    return true; // `a` consumed
  });
  assert.deepEqual(hitIds.sort(), ["b1", "b2"], "both bullets registered a hit");
});
