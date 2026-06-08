// test/enemy_identity.test.js
//
// Issue #1 guard: the four ground-enemy types must render as four DISTINCT
// colors (they previously shared two), and the gameplay-critical bulletproof
// Enforcer must carry a visible armor outline so it cannot be confused with the
// shootable Barrel Dumper. Pure draw-layer checks against a recording fake ctx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENEMY_COLORS, createEnemy, ENEMY_TYPES } from "../src/entities/enemies.js";
import { drawVehicle } from "../src/render/shapes.js";
import { palette } from "../src/data/palette.js";

// A fake 2D ctx that records the methods/styles the draw paths touch.
function recordingCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    _fill: null,
    _stroke: null,
    set fillStyle(v) { this._fill = v; calls.push({ name: "fillStyle", args: [v] }); },
    get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; calls.push({ name: "strokeStyle", args: [v] }); },
    get strokeStyle() { return this._stroke; },
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    beginPath: rec("beginPath"), closePath: rec("closePath"), moveTo: rec("moveTo"),
    lineTo: rec("lineTo"), arc: rec("arc"), arcTo: rec("arcTo"), ellipse: rec("ellipse"),
    fill: rec("fill"), stroke: rec("stroke"), fillRect: rec("fillRect"),
    save: rec("save"), restore: rec("restore"), translate: rec("translate"), scale: rec("scale"),
  };
}

test("the four enemy types map to four distinct body colors", () => {
  const colors = ENEMY_TYPES.map((t) => ENEMY_COLORS[t]);
  assert.equal(new Set(colors).size, 4, `expected 4 distinct colors, got ${colors}`);
  // The must-ram Enforcer and the shootable Barrel Dumper must NOT share a color.
  assert.notEqual(ENEMY_COLORS.enforcer, ENEMY_COLORS.barrelDumper);
});

test("drawVehicle strokes an outline when the outline style is set", () => {
  const ctx = recordingCtx();
  drawVehicle(ctx, 100, 100, 40, 60, { body: "#fff", outline: "#000", outlineWidth: 2 });
  assert.ok(ctx.calls.some((c) => c.name === "stroke"), "outline should stroke the body");
  assert.ok(ctx.calls.some((c) => c.name === "strokeStyle" && c.args[0] === "#000"));
});

test("the bulletproof Enforcer draws a white armor outline; others do not", () => {
  const opts = {};
  const enforcer = createEnemy("enforcer", 270, opts);
  const ec = recordingCtx();
  enforcer.draw(ec);
  // The Enforcer strokes hudText TWICE: once for the body armor outline (in
  // drawVehicle) and once for the chevron glyph (in _drawGlyph). Counting >= 2
  // guards BOTH cues — a body-outline-only pass would only reach 1.
  const enforcerHudStrokes = ec.calls.filter(
    (c) => c.name === "strokeStyle" && c.args[0] === palette.hudText,
  ).length;
  assert.ok(
    enforcerHudStrokes >= 2,
    "Enforcer should stroke hudText for BOTH the body outline and the chevron",
  );

  const switchblade = createEnemy("switchblade", 270, opts);
  const sc = recordingCtx();
  switchblade.draw(sc);
  const switchbladeHudStrokes = sc.calls.filter(
    (c) => c.name === "strokeStyle" && c.args[0] === palette.hudText,
  ).length;
  assert.equal(
    switchbladeHudStrokes,
    0,
    "Switchblade should NOT draw the armor outline or chevron",
  );
});

test("every enemy type draws without throwing", () => {
  for (const t of ENEMY_TYPES) {
    const e = createEnemy(t, 270, {});
    e.y = 200;
    assert.doesNotThrow(() => e.draw(recordingCtx()), `draw threw for ${t}`);
  }
});
