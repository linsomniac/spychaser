import { test } from "node:test";
import assert from "node:assert/strict";

import { createRng } from "../src/engine/rng.js";

test("rng: same seed produces identical sequence (deterministic)", () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test("rng: different seeds produce different sequences", () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test("rng: next() stays within [0, 1)", () => {
  const r = createRng(99);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test("rng: range() stays within [min, max)", () => {
  const r = createRng(7);
  for (let i = 0; i < 10000; i++) {
    const v = r.range(-3.5, 9.25);
    assert.ok(v >= -3.5 && v < 9.25, `value out of range: ${v}`);
  }
});

test("rng: int() is inclusive on both ends and stays in range", () => {
  const r = createRng(42);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const v = r.int(3, 7);
    assert.ok(Number.isInteger(v), `not an integer: ${v}`);
    assert.ok(v >= 3 && v <= 7, `value out of range: ${v}`);
    seen.add(v);
  }
  // With this many draws every value in [3, 7] should appear.
  for (const n of [3, 4, 5, 6, 7]) {
    assert.ok(seen.has(n), `int() never produced ${n}`);
  }
});

test("rng: int(n, n) always returns n", () => {
  const r = createRng(5);
  for (let i = 0; i < 100; i++) {
    assert.equal(r.int(4, 4), 4);
  }
});

test("rng: pick() returns an element of the array", () => {
  const r = createRng(3);
  const arr = ["a", "b", "c", "d"];
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = r.pick(arr);
    assert.ok(arr.includes(v));
    seen.add(v);
  }
  assert.equal(seen.size, arr.length, "pick() did not cover all elements");
});

test("rng: pick() throws on empty array", () => {
  const r = createRng(1);
  assert.throws(() => r.pick([]), RangeError);
});

test("rng: a fresh same-seed rng reproduces a derived rng's stream", () => {
  // Determinism guard against accidental Math.random fallthrough.
  const r1 = createRng(2026);
  const first = [r1.next(), r1.next(), r1.next()];
  const r2 = createRng(2026);
  const second = [r2.next(), r2.next(), r2.next()];
  assert.deepEqual(first, second);
});
