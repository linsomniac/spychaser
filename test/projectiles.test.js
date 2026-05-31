// test/projectiles.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Projectiles } from "../src/entities/projectiles.js";
import { config } from "../src/data/config.js";

const B = config.weapons.bullet;

test("spawn makes a live bullet with the descriptor's position/velocity", () => {
  const proj = new Projectiles();
  const b = proj.spawn({ x: 100, y: 200, vx: 0, vy: -B.speed });
  assert.equal(proj.activeCount, 1);
  assert.equal(b.x, 100);
  assert.equal(b.y, 200);
  assert.equal(b.vy, -B.speed);
  assert.equal(b.active, true);
  assert.equal(b.category, "playerBullet");
});

test("bullet travels by its velocity each update", () => {
  const proj = new Projectiles();
  proj.spawn({ x: 0, y: 300, vx: 0, vy: -600 });
  proj.update(0.5);
  let b = null;
  proj.forEach((p) => (b = p));
  assert.ok(Math.abs(b.y - (300 - 300)) < 1e-6); // 300 - 600*0.5
});

test("bullet expires after its ttl", () => {
  const proj = new Projectiles();
  proj.spawn({ x: 100, y: 300, vx: 0, vy: 0, ttl: 0.1 });
  proj.update(0.05);
  assert.equal(proj.activeCount, 1);
  proj.update(0.1); // total 0.15 > ttl
  assert.equal(proj.activeCount, 0);
});

test("bullet expires when it leaves the top of the play field", () => {
  const proj = new Projectiles();
  // Place near the top moving up fast; one big step takes it off-screen.
  proj.spawn({ x: 100, y: 10, vx: 0, vy: -config.weapons.bullet.speed, ttl: 5 });
  proj.update(0.2);
  assert.equal(proj.activeCount, 0);
});

test("bullet.bounds is a top-left AABB derived from its center", () => {
  const proj = new Projectiles();
  const b = proj.spawn({ x: 100, y: 200, vx: 0, vy: 0 });
  const bb = b.bounds;
  assert.equal(bb.x, 100 - B.width / 2);
  assert.equal(bb.y, 200 - B.height / 2);
  assert.equal(bb.w, B.width);
  assert.equal(bb.h, B.height);
});

test("kill despawns a bullet on impact and recycles it", () => {
  const proj = new Projectiles();
  const b = proj.spawn({ x: 100, y: 200, vx: 0, vy: 0, ttl: 5 });
  assert.equal(proj.activeCount, 1);
  proj.kill(b);
  assert.equal(proj.activeCount, 0);
  // Pool reuse: a new spawn does not grow the active set beyond one.
  proj.spawn({ x: 0, y: 0, vx: 0, vy: 0 });
  assert.equal(proj.activeCount, 1);
});

test("toArray returns the live bullets for the collision broad phase", () => {
  const proj = new Projectiles();
  proj.spawn({ x: 0, y: 0, vx: 0, vy: 0 });
  proj.spawn({ x: 1, y: 1, vx: 0, vy: 0 });
  const arr = proj.toArray();
  assert.equal(arr.length, 2);
  assert.ok(arr[0].bounds);
});

test("clear removes all bullets", () => {
  const proj = new Projectiles();
  proj.spawn({ x: 0, y: 0, vx: 0, vy: 0 });
  proj.spawn({ x: 0, y: 0, vx: 0, vy: 0 });
  proj.clear();
  assert.equal(proj.activeCount, 0);
});
