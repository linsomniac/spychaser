import { test } from "node:test";
import assert from "node:assert/strict";

import { Road } from "../src/systems/road.js";
import { config } from "../src/data/config.js";

const road = config.road;

test("road: same seed produces identical samples (deterministic)", () => {
  const a = new Road({ seed: 2026 });
  const b = new Road({ seed: 2026 });
  for (let d = 0; d <= 20000; d += 137) {
    const sa = a.sampleAt(d);
    const sb = b.sampleAt(d);
    assert.deepEqual(sa, sb, `divergence at distance ${d}`);
  }
});

test("road: different seeds eventually diverge", () => {
  const a = new Road({ seed: 1 });
  const b = new Road({ seed: 2 });
  let differ = false;
  for (let d = 0; d <= 20000; d += 211) {
    const sa = a.sampleAt(d);
    const sb = b.sampleAt(d);
    if (Math.abs(sa.centerX - sb.centerX) > 1e-9 || Math.abs(sa.width - sb.width) > 1e-9) {
      differ = true;
      break;
    }
  }
  assert.ok(differ, "two different seeds produced identical road over 20000px");
});

test("road: sampling is pure and order-independent (repeatable)", () => {
  const r = new Road({ seed: 7 });
  const first = r.sampleAt(5000);
  // Sample a bunch of other distances in between.
  for (let d = 0; d < 12000; d += 91) r.sampleAt(d);
  const again = r.sampleAt(5000);
  assert.deepEqual(first, again, "sampling the same distance twice changed result");
});

test("road: width stays within configured bounds", () => {
  const r = new Road({ seed: 99 });
  for (let d = 0; d <= 60000; d += 53) {
    const s = r.sampleAt(d);
    assert.ok(
      s.width >= r.minWidth - 1e-6 && s.width <= r.maxWidth + 1e-6,
      `width ${s.width} out of [${r.minWidth}, ${r.maxWidth}] at ${d}`,
    );
  }
});

test("road: center stays on-field so road plus shoulders fit the play area", () => {
  const r = new Road({ seed: 314 });
  const W = config.VIRTUAL_WIDTH;
  for (let d = 0; d <= 60000; d += 71) {
    const s = r.sampleAt(d);
    const halfTotal = s.width / 2 + s.shoulderWidth;
    assert.ok(s.centerX - halfTotal >= -1e-6, `road runs off left at ${d}`);
    assert.ok(s.centerX + halfTotal <= W + 1e-6, `road runs off right at ${d}`);
  }
});

test("road: left/right edges are consistent with center and width", () => {
  const r = new Road({ seed: 8 });
  for (let d = 0; d <= 10000; d += 123) {
    const s = r.sampleAt(d);
    assert.ok(Math.abs(s.leftEdge - (s.centerX - s.width / 2)) < 1e-9);
    assert.ok(Math.abs(s.rightEdge - (s.centerX + s.width / 2)) < 1e-9);
    assert.ok(s.rightEdge > s.leftEdge);
  }
});

test("road: shoulder width is positive and matches config", () => {
  const r = new Road({ seed: 5 });
  const s = r.sampleAt(1234);
  assert.equal(s.shoulderWidth, road.shoulderWidth);
  assert.ok(s.shoulderWidth > 0);
});

test("road: sector counter advances with distance and is monotonic", () => {
  const r = new Road({ seed: 1 });
  const s0 = r.sectorAt(0);
  const s1 = r.sectorAt(road.sectorLength * 1.5);
  const s2 = r.sectorAt(road.sectorLength * 4.2);
  assert.equal(s0, 0);
  assert.equal(s1, 1);
  assert.equal(s2, 4);
  // Monotonic non-decreasing.
  let prev = -1;
  for (let d = 0; d <= road.sectorLength * 10; d += road.sectorLength / 7) {
    const sec = r.sectorAt(d);
    assert.ok(sec >= prev, `sector went backwards at ${d}`);
    prev = sec;
  }
  // sampleAt should report the same sector as sectorAt for the same distance.
  const d = road.sectorLength * 3.3;
  assert.equal(r.sampleAt(d).sector, r.sectorAt(d));
});

test("road: water flag occurs somewhere over a long run", () => {
  const r = new Road({ seed: 2026 });
  let sawWater = false;
  let sawLand = false;
  for (let d = 0; d <= 200000; d += 37) {
    const s = r.sampleAt(d);
    if (s.water) sawWater = true;
    else sawLand = true;
    if (sawWater && sawLand) break;
  }
  assert.ok(sawWater, "no water section appeared over 200000px");
  assert.ok(sawLand, "road was always water (no land)");
});

test("road: water flag is deterministic for a seed", () => {
  const a = new Road({ seed: 42 });
  const b = new Road({ seed: 42 });
  for (let d = 0; d <= 80000; d += 263) {
    assert.equal(a.sampleAt(d).water, b.sampleAt(d).water, `water mismatch at ${d}`);
  }
});

test("road: curve offset stays within configured amplitude", () => {
  const r = new Road({ seed: 17 });
  for (let d = 0; d <= 60000; d += 47) {
    const s = r.sampleAt(d);
    assert.ok(
      Math.abs(s.curve) <= road.curveAmplitude + 1e-6,
      `curve ${s.curve} exceeds amplitude ${road.curveAmplitude} at ${d}`,
    );
  }
});

test("road: curve is continuous (no large jumps between nearby samples)", () => {
  // AIDEV-NOTE: a sine-based centerline must be smooth; a big discontinuity
  // between adjacent samples would mean a visible "teleport" of the road.
  const r = new Road({ seed: 3 });
  let prev = r.sampleAt(0).centerX;
  for (let d = 1; d <= 30000; d += 1) {
    const c = r.sampleAt(d).centerX;
    assert.ok(Math.abs(c - prev) < 5, `center jumped by ${Math.abs(c - prev)} at ${d}`);
    prev = c;
  }
});

test("road: negative distance clamps to start (no NaN / no throw)", () => {
  const r = new Road({ seed: 1 });
  const s = r.sampleAt(-500);
  assert.ok(Number.isFinite(s.centerX));
  assert.ok(Number.isFinite(s.width));
  assert.equal(s.sector, 0);
});

test("road: reset reseeds deterministically", () => {
  const r = new Road({ seed: 1 });
  const before = r.sampleAt(9000);
  r.reset(123);
  const reseeded = r.sampleAt(9000);
  const fresh = new Road({ seed: 123 });
  assert.deepEqual(reseeded, fresh.sampleAt(9000));
  // And it actually changed from the original seed's road.
  assert.notDeepEqual(before, reseeded);
});
