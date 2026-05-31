import { test } from "node:test";
import assert from "node:assert/strict";

import { Input, DEFAULT_KEYMAP } from "../src/engine/input.js";

// Synthesize a KeyboardEvent-like object. The Input handlers only read `.code`
// and call `.preventDefault()`, so this is sufficient without a DOM.
function ev(code) {
  return { code, preventDefault() {} };
}

function down(input, code) {
  input._handleKeyDown(ev(code));
}
function up(input, code) {
  input._handleKeyUp(ev(code));
}

test("input: default keymap covers spec section 9 actions", () => {
  const actions = new Set(Object.values(DEFAULT_KEYMAP));
  for (const a of ["left", "right", "accel", "brake", "fire", "special", "pause"]) {
    assert.ok(actions.has(a), `missing action mapping: ${a}`);
  }
});

test("input: arrows and WASD map to movement", () => {
  const i = new Input();
  down(i, "ArrowLeft");
  assert.ok(i.isDown("left"));
  up(i, "ArrowLeft");
  assert.ok(!i.isDown("left"));

  down(i, "KeyD");
  assert.ok(i.isDown("right"));
  down(i, "KeyW");
  assert.ok(i.isDown("accel"));
  down(i, "KeyS");
  assert.ok(i.isDown("brake"));
});

test("input: Space fires", () => {
  const i = new Input();
  down(i, "Space");
  assert.ok(i.isDown("fire"));
  up(i, "Space");
  assert.ok(!i.isDown("fire"));
});

test("input: F triggers special", () => {
  const i = new Input();
  down(i, "KeyF");
  assert.ok(i.isDown("special"));
  up(i, "KeyF");
  assert.ok(!i.isDown("special"));
});

test("input: Shift (either side) triggers special", () => {
  const i = new Input();
  down(i, "ShiftLeft");
  assert.ok(i.isDown("special"));
  up(i, "ShiftLeft");
  assert.ok(!i.isDown("special"));

  down(i, "ShiftRight");
  assert.ok(i.isDown("special"));
  up(i, "ShiftRight");
  assert.ok(!i.isDown("special"));
});

test("input: F OR Shift ref-count keeps special held until both release", () => {
  // The crux of the F-OR-Shift binding: releasing one must not clear special
  // while the other is still held.
  const i = new Input();
  down(i, "KeyF");
  down(i, "ShiftLeft");
  assert.ok(i.isDown("special"));
  up(i, "KeyF"); // one of two released
  assert.ok(i.isDown("special"), "special should stay held while Shift is down");
  up(i, "ShiftLeft"); // last one released
  assert.ok(!i.isDown("special"));
});

test("input: P and Escape both pause", () => {
  const i = new Input();
  down(i, "KeyP");
  assert.ok(i.isDown("pause"));
  up(i, "KeyP");
  down(i, "Escape");
  assert.ok(i.isDown("pause"));
});

test("input: auto-repeat keydown does not double-count", () => {
  const i = new Input();
  down(i, "ArrowUp");
  down(i, "ArrowUp"); // OS auto-repeat
  down(i, "ArrowUp");
  assert.ok(i.isDown("accel"));
  up(i, "ArrowUp"); // single release should fully clear
  assert.ok(!i.isDown("accel"));
});

test("input: wasPressed/consumePressed is edge-triggered", () => {
  const i = new Input();
  down(i, "Space");
  assert.ok(i.wasPressed("fire"));
  const pressed = i.consumePressed();
  assert.ok(pressed.has("fire"));
  // After consuming, the edge is gone even though the key is still held.
  assert.ok(!i.wasPressed("fire"));
  assert.ok(i.isDown("fire"));
});

test("input: holding a key does not re-fire the press edge", () => {
  const i = new Input();
  down(i, "KeyP");
  i.consumePressed();
  down(i, "KeyP"); // auto-repeat while held
  assert.ok(!i.wasPressed("pause"), "held key must not re-trigger the edge");
});

test("input: snapshot reflects held actions", () => {
  const i = new Input();
  down(i, "ArrowLeft");
  down(i, "Space");
  const snap = i.snapshot();
  assert.equal(snap.left, true);
  assert.equal(snap.fire, true);
  assert.equal(snap.right, false);
  assert.equal(snap.special, false);
});

test("input: clear releases everything (e.g. on blur)", () => {
  const i = new Input();
  down(i, "ArrowLeft");
  down(i, "Space");
  i.clear();
  assert.ok(!i.isDown("left"));
  assert.ok(!i.isDown("fire"));
});

test("input: unknown keys are ignored", () => {
  const i = new Input();
  down(i, "KeyZ");
  const snap = i.snapshot();
  assert.ok(Object.values(snap).every((v) => v === false));
});
