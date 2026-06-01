// test/hud.test.js
//
// Phase 10 — HUD pure-logic helpers. The HUD's DRAWING touches Canvas 2D (not
// unit-tested here), but its formatting/layout math is factored into free
// functions (spec §5): score formatting, the bonus-bar fill fraction, and the
// loaded-weapon box label. These run headlessly with no DOM.

import test from "node:test";
import assert from "node:assert/strict";

import { formatScore, bonusBarFraction, weaponBoxLabel } from "../src/render/hud.js";

// --- formatScore --------------------------------------------------------------

test("formatScore: zero-pads to the minimum digit count", () => {
  assert.equal(formatScore(0), "000,000");
  assert.equal(formatScore(42), "000,042");
});

test("formatScore: groups thousands with commas", () => {
  assert.equal(formatScore(1234567), "1,234,567");
  assert.equal(formatScore(1000), "001,000");
});

test("formatScore: floors fractional scores (arcade integers)", () => {
  assert.equal(formatScore(123.9), "000,123");
});

test("formatScore: clamps negatives to zero", () => {
  assert.equal(formatScore(-50), "000,000");
});

test("formatScore: honors a custom minimum digit count", () => {
  assert.equal(formatScore(7, 3), "007");
  assert.equal(formatScore(12345, 3), "12,345");
});

// --- bonusBarFraction ---------------------------------------------------------

test("bonusBarFraction: full at the start of the window", () => {
  assert.equal(bonusBarFraction(60, 60), 1);
});

test("bonusBarFraction: half-way through the window", () => {
  assert.equal(bonusBarFraction(30, 60), 0.5);
});

test("bonusBarFraction: empty once the window has closed", () => {
  assert.equal(bonusBarFraction(0, 60), 0);
});

test("bonusBarFraction: clamps to [0, 1]", () => {
  assert.equal(bonusBarFraction(-5, 60), 0);
  assert.equal(bonusBarFraction(120, 60), 1);
});

test("bonusBarFraction: zero/negative window is 0 (no divide-by-zero)", () => {
  assert.equal(bonusBarFraction(10, 0), 0);
  assert.equal(bonusBarFraction(10, -1), 0);
});

// --- weaponBoxLabel -----------------------------------------------------------

test("weaponBoxLabel: an empty slot reports EMPTY / not loaded", () => {
  assert.deepEqual(weaponBoxLabel(null), { loaded: false, label: "EMPTY", charge: 0 });
  assert.deepEqual(weaponBoxLabel(undefined), {
    loaded: false,
    label: "EMPTY",
    charge: 0,
  });
});

test("weaponBoxLabel: a depleted special (charge 0) reports EMPTY", () => {
  assert.deepEqual(weaponBoxLabel({ name: "MISSILES", charge: 0 }), {
    loaded: false,
    label: "EMPTY",
    charge: 0,
  });
});

test("weaponBoxLabel: a loaded special reports its name + remaining charge", () => {
  assert.deepEqual(weaponBoxLabel({ name: "MISSILES", charge: 3 }), {
    loaded: true,
    label: "MISSILES",
    charge: 3,
  });
});

test("weaponBoxLabel: falls back to the kind when no display name is present", () => {
  assert.deepEqual(weaponBoxLabel({ kind: "oil", charge: 2 }), {
    loaded: true,
    label: "OIL",
    charge: 2,
  });
});

export default null;
