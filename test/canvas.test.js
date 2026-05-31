import { test } from "node:test";
import assert from "node:assert/strict";

// Only import the pure geometry helper; GameCanvas itself needs a DOM.
import { computeLetterbox } from "../src/engine/canvas.js";

const VW = 540;
const VH = 720; // 3:4 aspect

test("letterbox: exact aspect match fills with no offset", () => {
  const lb = computeLetterbox(540, 720, VW, VH);
  assert.equal(lb.scale, 1);
  assert.equal(lb.offsetX, 0);
  assert.equal(lb.offsetY, 0);
  assert.equal(lb.width, 540);
  assert.equal(lb.height, 720);
});

test("letterbox: scales up uniformly for a larger same-aspect area", () => {
  const lb = computeLetterbox(1080, 1440, VW, VH);
  assert.equal(lb.scale, 2);
  assert.equal(lb.offsetX, 0);
  assert.equal(lb.offsetY, 0);
});

test("letterbox: wide area pillarboxes (bars on left/right)", () => {
  // Area 1080x720 is wider than 3:4 -> height-limited, horizontal bars.
  const lb = computeLetterbox(1080, 720, VW, VH);
  assert.equal(lb.scale, 1); // limited by height: 720/720
  assert.equal(lb.height, 720);
  assert.equal(lb.width, 540);
  assert.equal(lb.offsetX, (1080 - 540) / 2);
  assert.equal(lb.offsetY, 0);
});

test("letterbox: tall area letterboxes (bars on top/bottom)", () => {
  // Area 540x1440 is taller than 3:4 -> width-limited, vertical bars.
  const lb = computeLetterbox(540, 1440, VW, VH);
  assert.equal(lb.scale, 1); // limited by width: 540/540
  assert.equal(lb.width, 540);
  assert.equal(lb.height, 720);
  assert.equal(lb.offsetX, 0);
  assert.equal(lb.offsetY, (1440 - 720) / 2);
});

test("letterbox: never distorts (uniform scale picks the smaller ratio)", () => {
  const lb = computeLetterbox(900, 600, VW, VH);
  const expected = Math.min(900 / VW, 600 / VH);
  assert.equal(lb.scale, expected);
  // Scaled field must fit inside the available area.
  assert.ok(lb.width <= 900 + 1e-9);
  assert.ok(lb.height <= 600 + 1e-9);
});

test("letterbox: centers the scaled field within the available area", () => {
  const lb = computeLetterbox(1000, 1000, VW, VH);
  assert.ok(Math.abs(lb.offsetX + lb.width / 2 - 500) < 1e-9);
  assert.ok(Math.abs(lb.offsetY + lb.height / 2 - 500) < 1e-9);
});
