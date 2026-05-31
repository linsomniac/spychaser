// engine/canvas.js
//
// Canvas setup and the virtual -> screen transform. The whole game is authored
// in a fixed 540x720 "virtual" space (see data/config.js). This module:
//   * sizes the backing store for the device pixel ratio (crisp on HiDPI),
//   * recomputes a letterbox transform on resize (scale + center, no stretch),
//   * exposes helpers to convert pointer coords back into virtual space.
//
// AIDEV-NOTE: The pure geometry lives in `computeLetterbox()` so it can be unit
// tested without a DOM. Everything DOM-touching is isolated in the class.

import { config } from "../data/config.js";

/**
 * @typedef {Object} Letterbox
 * @property {number} scale   uniform virtual->css-px scale factor
 * @property {number} offsetX css px from the left where the play field starts
 * @property {number} offsetY css px from the top where the play field starts
 * @property {number} width   scaled play-field width in css px
 * @property {number} height  scaled play-field height in css px
 */

/**
 * Compute a uniform "contain" letterbox: scale the virtual field to fit inside
 * the available CSS area without distortion, then center the leftover space.
 *
 * @param {number} availW available width in css px
 * @param {number} availH available height in css px
 * @param {number} virtualW virtual width
 * @param {number} virtualH virtual height
 * @returns {Letterbox}
 */
export function computeLetterbox(availW, availH, virtualW, virtualH) {
  const scale = Math.min(availW / virtualW, availH / virtualH);
  const width = virtualW * scale;
  const height = virtualH * scale;
  const offsetX = (availW - width) / 2;
  const offsetY = (availH - height) / 2;
  return { scale, offsetX, offsetY, width, height };
}

export class GameCanvas {
  /**
   * @param {HTMLCanvasElement} canvasEl
   * @param {{ virtualWidth?: number, virtualHeight?: number }} [opts]
   */
  constructor(canvasEl, opts = {}) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvasEl;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D rendering context");
    /** @type {CanvasRenderingContext2D} */
    this.ctx = ctx;

    this.virtualWidth = opts.virtualWidth ?? config.VIRTUAL_WIDTH;
    this.virtualHeight = opts.virtualHeight ?? config.VIRTUAL_HEIGHT;

    /** @type {number} device pixel ratio captured at last resize */
    this.dpr = 1;
    /** @type {Letterbox} */
    this.letterbox = computeLetterbox(1, 1, this.virtualWidth, this.virtualHeight);

    this._onResize = () => this.resize();
    this.resize();
  }

  /** Attach window resize handling. Returns a disposer. */
  listen() {
    window.addEventListener("resize", this._onResize);
    return () => window.removeEventListener("resize", this._onResize);
  }

  /**
   * Resize the backing store to the element's CSS size * DPR and recompute the
   * letterbox transform. Safe to call any time (e.g. on window resize).
   */
  resize() {
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    this.dpr = dpr;

    // CSS pixel size of the element (its layout box).
    const cssW = this.canvas.clientWidth || this.canvas.width || this.virtualWidth;
    const cssH = this.canvas.clientHeight || this.canvas.height || this.virtualHeight;

    // Backing store in device pixels.
    const backW = Math.max(1, Math.round(cssW * dpr));
    const backH = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== backW) this.canvas.width = backW;
    if (this.canvas.height !== backH) this.canvas.height = backH;

    this.letterbox = computeLetterbox(cssW, cssH, this.virtualWidth, this.virtualHeight);
  }

  /**
   * Apply the full device transform so subsequent draws can use virtual
   * coordinates directly. Resets any prior transform first.
   *
   * AIDEV-NOTE: order is DPR scale (device px) -> letterbox offset (css px) ->
   * uniform scale (virtual->css px). Because we pre-multiply DPR, the offset
   * and scale below are expressed in css px and the browser handles HiDPI.
   */
  applyTransform() {
    const { ctx, dpr, letterbox } = this;
    ctx.setTransform(
      letterbox.scale * dpr,
      0,
      0,
      letterbox.scale * dpr,
      letterbox.offsetX * dpr,
      letterbox.offsetY * dpr,
    );
  }

  /** Reset to the raw device-pixel coordinate system (for full-canvas clears). */
  resetTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Clear the entire backing store (including letterbox bars) to a solid color.
   * @param {string} color
   */
  clear(color) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Convert a screen/client coordinate (e.g. from a pointer event, relative to
   * the canvas's bounding rect) into virtual play-field coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  toVirtual(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const { scale, offsetX, offsetY } = this.letterbox;
    return {
      x: (cssX - offsetX) / scale,
      y: (cssY - offsetY) / scale,
    };
  }
}

export default GameCanvas;
