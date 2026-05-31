// test/effects.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleSystem } from "../src/render/effects.js";
import { createRng } from "../src/engine/rng.js";

test("spawn adds an active particle", () => {
  const ps = new ParticleSystem();
  assert.equal(ps.activeCount, 0);
  ps.spawn({ x: 10, y: 20, vx: 0, vy: 0, ttl: 1, size: 3, color: "#fff" });
  assert.equal(ps.activeCount, 1);
});

test("particle moves by its velocity each step", () => {
  const ps = new ParticleSystem();
  ps.spawn({ x: 0, y: 0, vx: 60, vy: -120, ttl: 10, size: 3, color: "#fff" });
  ps.update(0.5);
  let found = null;
  ps.forEach((p) => (found = p));
  assert.ok(found);
  assert.ok(Math.abs(found.x - 30) < 1e-6);
  assert.ok(Math.abs(found.y - -60) < 1e-6);
});

test("particle expires after its ttl and is recycled", () => {
  const ps = new ParticleSystem();
  ps.spawn({ x: 0, y: 0, vx: 0, vy: 0, ttl: 0.1, size: 3, color: "#fff" });
  ps.update(0.05);
  assert.equal(ps.activeCount, 1);
  ps.update(0.1); // total 0.15 > 0.1 ttl
  assert.equal(ps.activeCount, 0);
});

test("ttl-expired particles are returned to the pool (no leak)", () => {
  const ps = new ParticleSystem();
  for (let i = 0; i < 5; i++) ps.spawn({ x: 0, y: 0, vx: 0, vy: 0, ttl: 0.1, size: 1, color: "#fff" });
  assert.equal(ps.activeCount, 5);
  ps.update(0.2);
  assert.equal(ps.activeCount, 0);
  // Re-spawning should reuse pooled objects, not grow unbounded.
  for (let i = 0; i < 5; i++) ps.spawn({ x: 0, y: 0, vx: 0, vy: 0, ttl: 0.1, size: 1, color: "#fff" });
  assert.equal(ps.activeCount, 5);
});

test("life fraction decreases from 1 toward 0 over the particle's life", () => {
  const ps = new ParticleSystem();
  ps.spawn({ x: 0, y: 0, vx: 0, vy: 0, ttl: 1, size: 3, color: "#fff" });
  let p = null;
  ps.forEach((q) => (p = q));
  // age starts at 0 -> life == 1
  assert.ok(Math.abs(ps.lifeFrac(p) - 1) < 1e-6);
  ps.update(0.5);
  assert.ok(Math.abs(ps.lifeFrac(p) - 0.5) < 1e-6);
});

test("muzzleBurst spawns several particles deterministically with a seeded rng", () => {
  const rngA = createRng(123);
  const rngB = createRng(123);
  const a = new ParticleSystem();
  const b = new ParticleSystem();
  a.muzzleBurst(100, 200, rngA);
  b.muzzleBurst(100, 200, rngB);
  assert.ok(a.activeCount > 0);
  assert.equal(a.activeCount, b.activeCount);
  // Same seed -> identical first-particle state.
  let pa = null;
  let pb = null;
  a.forEach((p) => (pa = pa ?? p));
  b.forEach((p) => (pb = pb ?? p));
  assert.equal(pa.x, pb.x);
  assert.equal(pa.vx, pb.vx);
  assert.equal(pa.vy, pb.vy);
});

test("hitSpark spawns particles at the impact point", () => {
  const rng = createRng(7);
  const ps = new ParticleSystem();
  ps.hitSpark(300, 150, rng);
  assert.ok(ps.activeCount > 0);
  let p = null;
  ps.forEach((q) => (p = q));
  // Spawned near the impact point (within a small jitter).
  assert.ok(Math.abs(p.x - 300) < 30);
  assert.ok(Math.abs(p.y - 150) < 30);
});

test("clear removes all particles", () => {
  const ps = new ParticleSystem();
  const rng = createRng(1);
  ps.muzzleBurst(0, 0, rng);
  ps.hitSpark(0, 0, rng);
  assert.ok(ps.activeCount > 0);
  ps.clear();
  assert.equal(ps.activeCount, 0);
});
