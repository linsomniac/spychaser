// test/director.test.js
//
// Spawn director: deterministic, escalating spawns and milestone set-pieces.
// The director is pure logic; we drive it with a stub road sampler + a seeded
// RNG and assert: same seed -> same schedule, difficulty escalates with
// distance, enemy types unlock by distance, and set-pieces are spaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Director } from "../src/systems/director.js";
import { createRng } from "../src/engine/rng.js";
import { config } from "../src/data/config.js";
import { ENEMY_TYPES } from "../src/entities/enemies.js";

const D = config.director;

// Minimal deterministic road stub: a straight, fixed-width road centered on the
// field. Enough for the director to place lanes.
function roadStub() {
  const W = config.VIRTUAL_WIDTH;
  const width = 320;
  return {
    sampleAt() {
      return {
        centerX: W / 2,
        width,
        leftEdge: W / 2 - width / 2,
        rightEdge: W / 2 + width / 2,
      };
    },
  };
}

// Run a director for a fixed distance at constant speed, collecting all events
// tagged with the distance at which they fired.
function runDirector(seed, { speed = 300, distance = 30000, dt = 1 / 60 } = {}) {
  const director = new Director({ config });
  const rng = createRng(seed);
  const road = roadStub();
  const events = [];
  let scroll = 0;
  const steps = Math.ceil(distance / (speed * dt));
  for (let i = 0; i < steps; i++) {
    scroll += speed * dt;
    const evs = director.update(dt, { distance: scroll, speed, road, rng });
    for (const ev of evs) events.push({ ...ev, distance: scroll });
  }
  return {
    events,
    spawns: events.filter((e) => e.kind === "enemy" || e.kind === "civilian"),
    enemies: events.filter((e) => e.kind === "enemy"),
    civilians: events.filter((e) => e.kind === "civilian"),
    setpieces: events.filter((e) => e.kind === "setpiece"),
  };
}

function signature(events) {
  return events
    .map((e) => `${e.kind}:${e.type ?? e.name ?? ""}:${(e.x ?? 0).toFixed(3)}:${e.distance.toFixed(2)}`)
    .join("|");
}

test("director: same seed produces an identical schedule (deterministic)", () => {
  const a = runDirector(42);
  const b = runDirector(42);
  assert.ok(a.events.length > 0, "director produced no events");
  assert.equal(a.events.length, b.events.length);
  assert.equal(signature(a.events), signature(b.events));
});

test("director: different seeds produce different schedules", () => {
  const a = runDirector(1);
  const b = runDirector(2);
  assert.notEqual(signature(a.events), signature(b.events));
});

test("director: difficulty escalates with distance (denser spawns later)", () => {
  // Compare spawn density in an early window vs a late window of equal length.
  const { spawns } = runDirector(7, { distance: 60000 });
  const windowLen = 10000;
  const early = spawns.filter((s) => s.distance < windowLen).length;
  const late = spawns.filter(
    (s) => s.distance >= 50000 && s.distance < 50000 + windowLen,
  ).length;
  assert.ok(late > early, `expected denser late spawns: early=${early} late=${late}`);
});

test("director: no enemies spawn before the warmup distance", () => {
  const { enemies } = runDirector(7, { distance: 5000 });
  const tooEarly = enemies.filter((s) => s.distance < D.warmupDistance);
  assert.equal(tooEarly.length, 0);
});

test("director: tougher enemy types are gated by distance", () => {
  const { enemies } = runDirector(99, { distance: 60000 });
  // Enforcer is the last to unlock (distance 26000). None should appear before.
  const earlyEnforcer = enemies.filter(
    (s) => s.type === "enforcer" && s.distance < 26000,
  );
  assert.equal(earlyEnforcer.length, 0, "Enforcer appeared before its unlock");
  // The only type available very early (< 5000) is the Switchblade.
  const veryEarly = enemies.filter((s) => s.distance < 5000);
  assert.ok(veryEarly.length > 0, "no early enemies to check");
  for (const e of veryEarly) {
    assert.equal(e.type, "switchblade", `unexpected early type ${e.type}`);
  }
});

test("director: every enemy type appears over a long run", () => {
  const { enemies } = runDirector(3, { distance: 120000 });
  const types = new Set(enemies.map((e) => e.type));
  for (const t of ENEMY_TYPES) {
    assert.ok(types.has(t), `enemy type ${t} never spawned`);
  }
});

test("director: set-pieces fire and are spaced by their configured cadence", () => {
  const { setpieces } = runDirector(11, { distance: 100000 });
  assert.ok(setpieces.length > 0, "no set-pieces fired");
  /** @type {Record<string, number[]>} */
  const byName = {};
  for (const sp of setpieces) (byName[sp.name] ??= []).push(sp.distance);

  // Per-tick spawn step (max distance traveled before a set-piece is noticed).
  const step = 300 * (1 / 60);
  for (const [name, distances] of Object.entries(byName)) {
    const cfg = D.setpieces[name];
    assert.ok(cfg, `set-piece ${name} not in config`);
    // First trigger near firstAt (within its jitter + one spawn step).
    assert.ok(
      distances[0] >= cfg.firstAt - 1 && distances[0] <= cfg.firstAt + cfg.jitter + step + 1,
      `${name} first at ${distances[0]}, expected ~[${cfg.firstAt}, ${cfg.firstAt + cfg.jitter}]`,
    );
    // Consecutive triggers spaced by ~spacing (within jitter tolerance).
    for (let i = 1; i < distances.length; i++) {
      const gap = distances[i] - distances[i - 1];
      assert.ok(
        gap >= cfg.spacing - cfg.jitter - step - 1 &&
          gap <= cfg.spacing + cfg.jitter + step + 1,
        `${name} gap ${gap} out of band for spacing ${cfg.spacing}+/-${cfg.jitter}`,
      );
    }
  }
});

test("director: weapons van set-piece appears within its first window", () => {
  const cfg = D.setpieces.weaponsVan;
  const { setpieces } = runDirector(5, { distance: cfg.firstAt + cfg.jitter + 500 });
  const van = setpieces.find((s) => s.name === "weaponsVan");
  assert.ok(van, "weapons van never fired in its first window");
});

test("director: every configured set-piece type eventually fires", () => {
  const { setpieces } = runDirector(13, { distance: 150000 });
  const names = new Set(setpieces.map((s) => s.name));
  for (const name of Object.keys(D.setpieces)) {
    assert.ok(names.has(name), `set-piece ${name} never fired`);
  }
});

test("director: spawn lanes stay within road bounds", () => {
  const { spawns } = runDirector(8, { distance: 20000 });
  const road = roadStub().sampleAt();
  assert.ok(spawns.length > 0);
  for (const s of spawns) {
    assert.ok(
      s.x >= road.leftEdge - 1 && s.x <= road.rightEdge + 1,
      `lane ${s.x} off road [${road.leftEdge}, ${road.rightEdge}]`,
    );
  }
});

test("director: nothing fires while stopped at distance 0 (speed 0)", () => {
  const director = new Director({ config });
  const rng = createRng(1);
  const road = roadStub();
  const events = [];
  for (let i = 0; i < 600; i++) {
    const evs = director.update(1 / 60, { distance: 0, speed: 0, road, rng });
    for (const ev of evs) events.push(ev);
  }
  const setpieces = events.filter((e) => e.kind === "setpiece");
  assert.equal(setpieces.length, 0, "set-pieces fired at zero distance");
  const spawns = events.filter((e) => e.kind !== "setpiece");
  assert.equal(spawns.length, 0, "traffic spawned while stopped");
});

test("director: reset replays the same schedule from the same seed", () => {
  const director = new Director({ config });
  const road = roadStub();

  function play(seedRng) {
    const out = [];
    let scroll = 0;
    for (let i = 0; i < 2000; i++) {
      scroll += 300 * (1 / 60);
      const evs = director.update(1 / 60, { distance: scroll, speed: 300, road, rng: seedRng });
      for (const ev of evs) out.push({ ...ev, distance: scroll });
    }
    return out;
  }

  const first = play(createRng(77));
  director.reset();
  const second = play(createRng(77));
  assert.equal(signature(first), signature(second));
});

test("director: difficulty() and unlockedEnemyCount() ramp monotonically", () => {
  const director = new Director({ config });
  assert.equal(director.difficulty(0), 0);
  assert.equal(director.difficulty(D.rampDistance), 1);
  assert.equal(director.difficulty(D.rampDistance * 2), 1, "difficulty clamps at 1");
  // Enemy unlock count is non-decreasing with distance.
  let prev = 0;
  for (let d = 0; d <= 60000; d += 1000) {
    const c = director.unlockedEnemyCount(d);
    assert.ok(c >= prev, `unlock count decreased at ${d}`);
    prev = c;
  }
  assert.equal(director.unlockedEnemyCount(0), 1);
  assert.equal(director.unlockedEnemyCount(60000), 4);
});
