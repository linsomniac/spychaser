// render/shapes.js
//
// Reusable vector-vehicle drawing helpers (spec §7: modern flat vector). All
// vehicles in Spy Chaser — the player, enemies, civilians, the weapons van —
// share the same rounded-rect body silhouette with a windshield and a couple of
// accent details, just recolored. Centralizing the drawing here keeps the look
// consistent and means later phases only pass colors, not geometry.
//
// AIDEV-NOTE: These are pure Canvas-2D drawing functions. They assume the caller
// has already applied the virtual->screen transform (engine/canvas.js) so every
// coordinate here is in virtual px. They take an explicit center (cx, cy) and
// draw the vehicle pointing "up" the screen (the direction of travel). Keep this
// file free of game state — it only knows how to paint a shape from parameters.

/**
 * Trace a rounded-rectangle path centered on (cx, cy). Does not fill or stroke;
 * the caller decides. Radius is clamped so it never exceeds half the smaller
 * side (which would invert the corners).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx center x, virtual px
 * @param {number} cy center y, virtual px
 * @param {number} w  width, virtual px
 * @param {number} h  height, virtual px
 * @param {number} r  corner radius, virtual px
 */
export function roundedRectPath(ctx, cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/**
 * @typedef {Object} VehicleStyle
 * @property {string} body      main body fill
 * @property {string} [accent]  windshield / canopy fill (defaults to a tint)
 * @property {string} [stripe]  optional center racing stripe
 * @property {string} [exhaust] optional rear flame color (drawn when boosting)
 * @property {number} [radius]  corner radius override
 */

/**
 * Draw a top-down vehicle: a rounded body, a windshield near the front, side
 * accents (mirrors/intakes), and an optional exhaust flame. The vehicle faces
 * "up" the screen; `facing` flips it 180° for oncoming traffic.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx center x, virtual px
 * @param {number} cy center y, virtual px
 * @param {number} w  body width, virtual px
 * @param {number} h  body height, virtual px
 * @param {VehicleStyle} style
 * @param {Object} [opts]
 * @param {number} [opts.facing]   1 = facing up (player/allies), -1 = facing down
 * @param {boolean} [opts.boosting] draw the exhaust flame
 * @param {boolean} [opts.shadow]  draw a soft drop shadow under the car
 */
export function drawVehicle(ctx, cx, cy, w, h, style, opts = {}) {
  const facing = opts.facing ?? 1;
  const radius = style.radius ?? Math.min(w, h) * 0.28;
  const accent = style.accent ?? "rgba(255,255,255,0.55)";

  ctx.save();
  ctx.translate(cx, cy);
  // facing flips the local Y so "front" is always toward smaller local-y.
  ctx.scale(1, facing);

  // Soft drop shadow (spec §7) — a darker rounded rect offset down/right.
  if (opts.shadow) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000000";
    roundedRectPath(ctx, 2.5, 3.5, w, h, radius);
    ctx.fill();
    ctx.restore();
  }

  // Exhaust flame behind the car (drawn first so the body overlaps it).
  if (opts.boosting && style.exhaust) {
    drawExhaust(ctx, 0, h / 2, w * 0.42, style.exhaust);
  }

  // Body.
  ctx.fillStyle = style.body;
  roundedRectPath(ctx, 0, 0, w, h, radius);
  ctx.fill();

  // Optional center stripe running front-to-back.
  if (style.stripe) {
    ctx.fillStyle = style.stripe;
    roundedRectPath(ctx, 0, 0, Math.max(3, w * 0.16), h * 0.82, radius * 0.5);
    ctx.fill();
  }

  // Windshield / canopy near the front (front = negative local y).
  ctx.fillStyle = accent;
  roundedRectPath(ctx, 0, -h * 0.2, w * 0.62, h * 0.26, radius * 0.6);
  ctx.fill();

  // Side accents (mirrors / intakes) as two small rounded nubs.
  ctx.fillStyle = accent;
  const nubW = Math.max(2, w * 0.12);
  const nubH = Math.max(3, h * 0.16);
  roundedRectPath(ctx, -w / 2 + nubW * 0.3, -h * 0.02, nubW, nubH, nubW * 0.5);
  ctx.fill();
  roundedRectPath(ctx, w / 2 - nubW * 0.3, -h * 0.02, nubW, nubH, nubW * 0.5);
  ctx.fill();

  ctx.restore();
}

/**
 * Draw a simple tapered exhaust flame (a couple of stacked triangles) centered
 * at (x, y) pointing in +local-y. Used for the player's boost.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w flame base width
 * @param {string} color
 */
export function drawExhaust(ctx, x, y, w, color) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x, y + w * 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export default { roundedRectPath, drawVehicle, drawExhaust };
