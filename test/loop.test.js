import { test } from "node:test";
import assert from "node:assert/strict";

import { Loop } from "../src/engine/loop.js";

function makeRecorder() {
  const updates = [];
  const renders = [];
  return {
    updates,
    renders,
    update: (dt) => updates.push(dt),
    render: (alpha) => renders.push(alpha),
  };
}

test("loop: requires an update function", () => {
  assert.throws(() => new Loop({}), TypeError);
  assert.throws(() => new Loop(), TypeError);
});

test("loop: step must be positive", () => {
  assert.throws(() => new Loop({ update() {}, step: 0 }), RangeError);
  assert.throws(() => new Loop({ update() {}, step: -1 }), RangeError);
});

test("loop: first frame establishes baseline and runs no updates", () => {
  const r = makeRecorder();
  const loop = new Loop({ update: r.update, render: r.render, step: 1 / 60 });
  const steps = loop.frame(1000);
  assert.equal(steps, 0);
  assert.equal(r.updates.length, 0);
  assert.equal(r.renders.length, 1, "render should still happen on first frame");
});

test("loop: accumulates one fixed step per 1/60s of elapsed time", () => {
  const r = makeRecorder();
  const step = 1 / 60;
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  // 20ms => 0.02s / (1/60) = 1.2 => exactly 1 step (clearly off any boundary).
  const steps = loop.frame(20);
  assert.equal(steps, 1);
  assert.equal(r.updates.length, 1);
  assert.equal(r.updates[0], step, "update must receive the fixed step, not real dt");
});

test("loop: a long frame runs multiple fixed steps", () => {
  const r = makeRecorder();
  const step = 1 / 60;
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  // 105ms elapsed => 0.105s / (1/60) = 6.3 => 6 steps, remainder < step.
  // (105ms is deliberately NOT on a step boundary to avoid float ambiguity.)
  const steps = loop.frame(105);
  assert.equal(steps, 6);
  assert.equal(r.updates.length, 6);
  for (const dt of r.updates) {
    assert.equal(dt, step);
  }
});

test("loop: caps elapsed time to maxFrameTime (no spiral of death)", () => {
  const r = makeRecorder();
  const step = 0.02; // 50Hz
  const loop = new Loop({
    update: r.update,
    render: r.render,
    step,
    maxFrameTime: 0.25,
  });
  loop.frame(0);
  // Simulate a 10 second stall. Without the cap this would run ~500 steps.
  const steps = loop.frame(10_000);
  // 0.25s cap / 0.02 = 12.5 => 12 steps max (clearly fractional, no boundary).
  assert.equal(steps, 12);
  assert.equal(r.updates.length, 12);
});

test("loop: leftover time carries into accumulator across frames", () => {
  const r = makeRecorder();
  const step = 1 / 60; // ~16.667ms
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  // 10ms < one step => 0 updates, accumulator holds 10ms.
  let steps = loop.frame(10);
  assert.equal(steps, 0);
  // Another 10ms => total 20ms => 1 step, ~3.33ms remainder.
  steps = loop.frame(20);
  assert.equal(steps, 1);
  assert.ok(loop.accumulator > 0 && loop.accumulator < step);
});

test("loop: render receives interpolation alpha in [0,1)", () => {
  const r = makeRecorder();
  const step = 0.1;
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  // Advance half a step: 50ms elapsed, no full step, alpha ~= 0.5.
  loop.frame(50);
  const lastAlpha = r.renders[r.renders.length - 1];
  assert.ok(lastAlpha >= 0 && lastAlpha < 1, `alpha out of range: ${lastAlpha}`);
  assert.ok(Math.abs(lastAlpha - 0.5) < 1e-9, `alpha should be ~0.5, got ${lastAlpha}`);
});

test("loop: negative delta (clock went backwards) runs no updates", () => {
  const r = makeRecorder();
  const loop = new Loop({ update: r.update, render: r.render, step: 1 / 60 });
  loop.frame(1000);
  const steps = loop.frame(500); // time went backwards
  assert.equal(steps, 0);
  assert.equal(r.updates.length, 0);
});

test("loop: tickCount accumulates across frames", () => {
  const r = makeRecorder();
  const step = 1 / 60;
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  loop.frame(105); // 6 (0.105s)
  loop.frame(210); // +6 (0.105s + 0.005 leftover => 0.11s => 6)
  assert.equal(loop.tickCount, 12);
});

test("loop: reset clears accumulator and baseline", () => {
  const r = makeRecorder();
  const step = 1 / 60;
  const loop = new Loop({ update: r.update, render: r.render, step });
  loop.frame(0);
  loop.frame(10); // builds accumulator
  assert.ok(loop.accumulator > 0);
  loop.reset();
  assert.equal(loop.accumulator, 0);
  // After reset the next frame is a baseline again (no updates).
  const steps = loop.frame(1000);
  assert.equal(steps, 0);
});

test("loop: drives via injected requestFrame/now (start/stop)", () => {
  const r = makeRecorder();
  const step = 1 / 60;
  let t = 0;
  const queued = [];
  const loop = new Loop({
    update: r.update,
    render: r.render,
    step,
    now: () => t,
    requestFrame: (cb) => {
      queued.push(cb);
      return queued.length;
    },
    cancelFrame: () => {},
  });
  loop.start();
  assert.equal(loop.running, true);
  // Drain a few rAF callbacks, advancing the injected clock by 100ms each.
  for (let i = 0; i < 3; i++) {
    const cb = queued.shift();
    t += 100;
    cb(t);
  }
  loop.stop();
  assert.equal(loop.running, false);
  // First start() frame is a baseline; subsequent frames run steps.
  assert.ok(r.updates.length > 0);
  for (const dt of r.updates) assert.equal(dt, step);
});
