// test/projectiles_hostiles.test.js
// Phase 4 extension of the pooled Projectiles: enemy bullets + rolling barrels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Projectiles } from "../src/entities/projectiles.js";
import { config } from "../src/data/config.js";

test("spawnEnemyBullet travels downward with the right category/ttl", () => {
  const proj = new Projectiles();
  const b = proj.spawnEnemyBullet(100, 100, 0, 300);
  assert.equal(b.category, "enemyBullet");
  assert.equal(b.vy, 300);
  assert.equal(b.ttl, config.hostiles.enemyBullet.ttl);
  proj.update(0.1);
  assert.equal(b.y, 130); // moved down
});

test("spawnBarrel sets a circular hitbox and accelerates downward", () => {
  const proj = new Projectiles();
  const ba = proj.spawnBarrel(100, 50);
  assert.equal(ba.category, "barrel");
  assert.equal(ba.radius, config.hostiles.barrel.radius);
  assert.equal(ba.w, config.hostiles.barrel.radius * 2);
  const v0 = ba.vy;
  proj.update(0.1);
  assert.ok(ba.vy > v0); // accelerated
  const v1 = ba.vy;
  proj.update(0.1);
  assert.ok(ba.vy > v1); // keeps accelerating
});

test("a recycled slot does not carry stale barrel state into a player bullet", () => {
  const proj = new Projectiles({ capacity: 1 });
  const barrel = proj.spawnBarrel(0, 0);
  proj.kill(barrel);
  // Re-acquire the same slot as a player bullet via the normal spawn path.
  const bullet = proj.spawn({ x: 10, y: 20, vx: 0, vy: -700 });
  assert.equal(bullet.category, "playerBullet");
  assert.equal(bullet.ay, 0);
  assert.equal(bullet.radius, 0);
  assert.equal(bullet.vy, -700);
});

test("player bullets are unaffected (no accel) by the new integration", () => {
  const proj = new Projectiles();
  const b = proj.spawn({ x: 0, y: 300, vx: 0, vy: -600 });
  proj.update(0.5);
  assert.ok(Math.abs(b.y - 0) < 1e-6); // 300 - 600*0.5, no accel drift
});

test("mixed categories coexist in one pool with shared cull rules", () => {
  const proj = new Projectiles();
  proj.spawn({ x: 100, y: 50, vx: 0, vy: -720, ttl: 0.05 }); // expires fast
  proj.spawnEnemyBullet(100, 100, 0, 200);
  proj.spawnBarrel(100, 60);
  proj.update(0.1);
  // The short-lived player bullet is culled; enemy bullet + barrel survive.
  assert.equal(proj.activeCount, 2);
});
