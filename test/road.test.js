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

// --- Water sections & boathouse markers (Phase 8) ---------------------------

test("road: waterSectionAt returns null on dry land and bounds inside water", () => {
  const r = new Road({ seed: 2026 });
  // Find a distance inside water by scanning.
  let waterD = -1;
  for (let d = 0; d <= 200000; d += 17) {
    if (r.sampleAt(d).water) {
      waterD = d;
      break;
    }
  }
  assert.ok(waterD >= 0, "expected to find a water distance for this seed");

  const sect = r.waterSectionAt(waterD);
  assert.ok(sect, "waterSectionAt should return bounds inside water");
  assert.ok(sect.start <= waterD && waterD < sect.end, "distance lies within bounds");
  assert.ok(sect.end > sect.start, "section has positive length");
  // Every distance reported as water must be inside the returned bounds.
  assert.ok(r.sampleAt(sect.start).water, "section start is water");
  assert.ok(r.sampleAt(sect.end - 1).water, "just before section end is water");

  // A clearly dry distance returns null.
  assert.equal(r.waterSectionAt(0), null, "start of run is dry land");
});

test("road: boathouseAt marks entry at section start and exit at section end", () => {
  const r = new Road({ seed: 2026 });
  let sect = null;
  for (let d = 0; d <= 200000; d += 17) {
    sect = r.waterSectionAt(d);
    if (sect) break;
  }
  assert.ok(sect, "found a water section");
  const bh = r.config.road.boathouseLength;

  // Entry boathouse: just after the start of the water stretch.
  assert.equal(r.boathouseAt(sect.start + 1), "entry", "entry band at section start");
  // Exit boathouse: just before the end of the water stretch.
  assert.equal(r.boathouseAt(sect.end - 1), "exit", "exit band at section end");
  // Open water in the middle is neither boathouse.
  const mid = (sect.start + sect.end) / 2;
  assert.equal(r.boathouseAt(mid), null, "middle of stretch is open water");
  // Dry land is never a boathouse.
  assert.equal(r.boathouseAt(0), null, "dry land is not a boathouse");
});

test("road: boathouse classification is deterministic for a seed", () => {
  const a = new Road({ seed: 7 });
  const b = new Road({ seed: 7 });
  for (let d = 0; d <= 80000; d += 199) {
    assert.equal(a.boathouseAt(d), b.boathouseAt(d), `boathouse mismatch at ${d}`);
  }
});

test("road: every boathouse distance is also water", () => {
  const r = new Road({ seed: 99 });
  for (let d = 0; d <= 120000; d += 23) {
    if (r.boathouseAt(d)) {
      assert.ok(r.sampleAt(d).water, `boathouse at ${d} must be over water`);
    }
  }
});

test("road: sample carries the boathouse classification", () => {
  const r = new Road({ seed: 2026 });
  let sect = null;
  for (let d = 0; d <= 200000; d += 17) {
    sect = r.waterSectionAt(d);
    if (sect) break;
  }
  assert.ok(sect);
  const s = r.sampleAt(sect.start + 1);
  assert.equal(s.water, true);
  assert.equal(s.boathouse, "entry");
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

// --- #17: the boathouse bands must fit inside the water stretch ----------------
// A water stretch carves a boathouse band out of EACH end (entry + exit); if
// boathouseLength*2 >= waterLength the two bands overlap and there is no open
// water channel between them. Guard the tunables so a future edit can't silently
// violate the invariant (it is otherwise unenforced in code).
test("config: boathouse bands fit inside a water stretch (boathouseLength*2 < waterLength)", () => {
  const r = config.road;
  assert.ok(
    r.boathouseLength * 2 < r.waterLength,
    `boathouse bands (${r.boathouseLength}*2) must leave open water inside waterLength (${r.waterLength})`,
  );
});
