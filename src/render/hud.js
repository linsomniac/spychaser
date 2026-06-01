// render/hud.js
//
// The heads-up display (spec §7 "HUD"): SCORE + HI-SCORE (top-left),
// DISTANCE / SECTOR (top-right), the bonus-time bar across the top, cars-left
// icons (bottom-left), and the loaded-weapon box (bottom-right) — matching the
// design mockup's corners-and-bar layout.
//
// AIDEV-NOTE: The DRAWING here touches Canvas 2D only (it assumes the
// virtual->screen transform is already applied, like the rest of render/*), but
// the PURE formatting/layout math — score formatting, the bonus-bar fill
// fraction, the weapon-box label — is factored into exported free functions that
// are unit-tested headlessly in test/hud.test.js (spec §5: keep logic out of the
// canvas layer). The HUD reads the world/scoring but never mutates them.

import { palette } from "../data/palette.js";

/**
 * Format a score as a zero-padded, thousands-grouped arcade number, e.g.
 * 1234567 -> "1,234,567" padded to at least `minDigits` significant digits.
 * Pure string math (no DOM). Negative inputs are clamped to 0.
 *
 * @param {number} value the score
 * @param {number} [minDigits] minimum displayed digit count (zero-padded)
 * @returns {string}
 */
export function formatScore(value, minDigits = 6) {
  const n = Math.max(0, Math.floor(value || 0));
  // Zero-pad to minDigits, then group every 3 digits with commas.
  const digits = String(n).padStart(minDigits, "0");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The bonus-time bar fill fraction in [0, 1]: full at the start of the window,
 * empty once it closes. Returns 0 for a non-positive window (avoids /0). Pure.
 *
 * @param {number} remaining seconds left in the window
 * @param {number} windowSeconds total window length
 * @returns {number} fill fraction in [0, 1]
 */
export function bonusBarFraction(remaining, windowSeconds) {
  if (!(windowSeconds > 0)) return 0;
  const f = remaining / windowSeconds;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Describe the loaded-weapon box contents. Reads a special descriptor (Phase 6
 * createSpecial: { name, charge, ... }) or null/undefined for an empty slot.
 * Pure: returns plain data the renderer paints. An empty / depleted slot reports
 * loaded:false so the box draws as an empty dock.
 *
 * @param {{name?:string, kind?:string, charge?:number}|null|undefined} special
 * @returns {{loaded:boolean, label:string, charge:number}}
 */
export function weaponBoxLabel(special) {
  if (!special || !(special.charge > 0)) {
    return { loaded: false, label: "EMPTY", charge: 0 };
  }
  const label = special.name ?? (special.kind ? special.kind.toUpperCase() : "SPECIAL");
  return { loaded: true, label, charge: special.charge };
}

export class Hud {
  /**
   * @param {import("../engine/canvas.js").GameCanvas} gameCanvas
   */
  constructor(gameCanvas) {
    this.gameCanvas = gameCanvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = gameCanvas.ctx;
  }

  /**
   * Draw the full HUD over the current world state. Caller draws this after the
   * scene (so it overlays). Reads from world.scoring + world.road/distance.
   * @param {import("../core/world.js").World} world
   */
  draw(world) {
    const { ctx } = this;
    const W = world.width;
    const H = world.height;
    const scoring = world.scoring;

    ctx.save();
    ctx.textBaseline = "top";

    // --- Top-left: SCORE + HI-SCORE -----------------------------------------
    this._label(8, 8, "SCORE");
    this._value(8, 22, formatScore(scoring.score));
    this._label(8, 46, "HI");
    this._value(8, 60, formatScore(scoring.hiScore), palette.hudDim);

    // --- Top-right: DISTANCE / SECTOR ---------------------------------------
    ctx.textAlign = "right";
    const km = (world.distance / 1000).toFixed(1);
    this._label(W - 8, 8, "SECTOR", "right");
    this._value(W - 8, 22, String(world.sector), palette.hudText, "right");
    this._label(W - 8, 46, "DIST", "right");
    this._value(W - 8, 60, `${km}k`, palette.hudDim, "right");
    ctx.textAlign = "left";

    // --- Bonus-time bar (across the top, under the corners) -----------------
    this._drawBonusBar(world);

    // --- Bottom-left: cars-left icons ---------------------------------------
    this._drawCarsLeft(world, 10, H - 10);

    // --- Bottom-right: loaded-weapon box ------------------------------------
    this._drawWeaponBox(world, W - 10, H - 10);

    ctx.restore();
  }

  /**
   * The bonus-time bar: a slim horizontal gauge centered under the top corners.
   * Width tracks the remaining window; it tints to danger as it drains and reads
   * "SUSPENDED" (danger) when a civilian hit has revoked it.
   * @param {import("../core/world.js").World} world
   * @private
   */
  _drawBonusBar(world) {
    const { ctx } = this;
    const W = world.width;
    const scoring = world.scoring;
    const cfg = world.config.scoring;

    const barW = W * 0.46;
    const barH = 7;
    const x = (W - barW) / 2;
    const y = 14;

    // Track.
    ctx.fillStyle = "rgba(11, 15, 26, 0.6)";
    this._roundRect(x - 2, y - 2, barW + 4, barH + 4, 4);
    ctx.fill();

    const frac = bonusBarFraction(scoring.bonusRemaining, cfg.bonusWindow);
    const suspended = scoring.bonusSuspended;
    // Fill: success while healthy, warning as it drains, danger when suspended.
    let fill = palette.success;
    if (suspended) fill = palette.danger;
    else if (frac < 0.25) fill = palette.danger;
    else if (frac < 0.5) fill = palette.laneMarker;

    if (frac > 0 && !suspended) {
      ctx.fillStyle = fill;
      this._roundRect(x, y, barW * frac, barH, 3);
      ctx.fill();
    } else if (suspended) {
      // Suspended: a hollow danger outline so it reads as revoked, not empty.
      ctx.strokeStyle = palette.danger;
      ctx.lineWidth = 1.5;
      this._roundRect(x, y, barW, barH, 3);
      ctx.stroke();
    }

    // Caption centered under the bar.
    ctx.textAlign = "center";
    ctx.fillStyle = suspended ? palette.danger : palette.hudDim;
    ctx.font = "700 8px system-ui, sans-serif";
    const caption = suspended ? "BONUS SUSPENDED" : "BONUS TIME";
    ctx.fillText(caption, world.width / 2, y + barH + 2);
    ctx.textAlign = "left";
  }

  /**
   * Cars-left icons (bottom-left): one small car silhouette per spare car in
   * reserve. Rows wrap if there are many banked cars.
   * @param {import("../core/world.js").World} world
   * @param {number} left  bottom-left anchor x
   * @param {number} bottom bottom-left anchor y
   * @private
   */
  _drawCarsLeft(world, left, bottom) {
    const { ctx } = this;
    const cars = world.scoring.cars;

    this._label(left, bottom - 12, "CARS");
    const iconW = 10;
    const iconH = 16;
    const gap = 4;
    const y = bottom - 12 - iconH - 2;
    const perRow = 6;
    for (let i = 0; i < cars; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const ix = left + col * (iconW + gap);
      const iy = y - row * (iconH + gap);
      this._carIcon(ix, iy, iconW, iconH);
    }
  }

  /**
   * The loaded-weapon box (bottom-right): a docked panel showing the loaded
   * special's name + remaining charges, or "EMPTY" when none is loaded. Reads a
   * loaded special from world.special / world.player.special if present (Phase 6
   * wiring); defensively shows EMPTY otherwise.
   * @param {import("../core/world.js").World} world
   * @param {number} right  bottom-right anchor x
   * @param {number} bottom bottom-right anchor y
   * @private
   */
  _drawWeaponBox(world, right, bottom) {
    const { ctx } = this;
    const special =
      world.special ?? (world.player && world.player.special) ?? null;
    const box = weaponBoxLabel(special);

    const boxW = 92;
    const boxH = 34;
    const x = right - boxW;
    const y = bottom - boxH;

    // Panel.
    ctx.fillStyle = palette.hudPanel;
    this._roundRect(x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.strokeStyle = box.loaded ? palette.special : palette.hudDim;
    ctx.lineWidth = 1.5;
    this._roundRect(x, y, boxW, boxH, 6);
    ctx.stroke();

    ctx.textAlign = "left";
    this._label(x + 7, y + 5, "WEAPON");
    ctx.fillStyle = box.loaded ? palette.special : palette.hudDim;
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillText(box.label, x + 7, y + 17);

    if (box.loaded) {
      // Charge pips along the bottom edge of the box.
      ctx.textAlign = "right";
      ctx.fillStyle = palette.hudText;
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.fillText(`x${box.charge}`, x + boxW - 7, y + 6);
    }
    ctx.textAlign = "left";
  }

  // --- low-level drawing helpers ------------------------------------------

  /** Draw a dim caption label. @private */
  _label(x, y, text, align = "left") {
    const { ctx } = this;
    ctx.fillStyle = palette.hudDim;
    ctx.font = "700 9px system-ui, sans-serif";
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  /** Draw a primary HUD value. @private */
  _value(x, y, text, color = palette.hudText, align = "left") {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.font = "800 18px system-ui, sans-serif";
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  /** A tiny car silhouette for the cars-left tally. @private */
  _carIcon(x, y, w, h) {
    const { ctx } = this;
    ctx.fillStyle = palette.player;
    this._roundRect(x, y, w, h, 3);
    ctx.fill();
    // Windshield highlight.
    ctx.fillStyle = palette.playerAccent;
    this._roundRect(x + 2, y + 3, w - 4, h * 0.32, 1.5);
    ctx.fill();
  }

  /**
   * Trace a rounded-rect path (no fill/stroke; caller chooses). Mirrors the
   * helper in render/shapes.js but takes a top-left origin for HUD panels.
   * @private
   */
  _roundRect(x, y, w, h, r) {
    const { ctx } = this;
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
}

export default Hud;
