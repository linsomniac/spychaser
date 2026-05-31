// render/renderer.js
//
// The thin Canvas 2D draw layer. It reads from the World (never mutates it) and
// paints the scene in virtual coordinates; engine/canvas.js has already applied
// the DPR + letterbox transform, so this module draws as if the play field were
// a fixed VIRTUAL_WIDTH x VIRTUAL_HEIGHT rectangle.
//
// Phase 1 draws the procedural road: grass backdrop, the road body and its
// grass shoulders (sampled per scanline so curves and width changes follow the
// road), and the scrolling dashed lane markers.
//
// AIDEV-NOTE: The renderer samples the Road at many y-rows per frame. Screen y
// maps to world distance via `distance + (height - y)`: the bottom of the
// screen (y = height) is "here" (the world's current distance) and rows above
// are further ahead. Keep this mapping consistent with collision/entity code in
// later phases or the road will visually disagree with gameplay.

import { palette } from "../data/palette.js";

/**
 * How finely to slice the screen vertically when drawing the curved road.
 * Smaller = smoother curves but more fills. 6px is plenty at this resolution.
 */
const ROW_HEIGHT = 6;

/**
 * Map a screen y (0 = top) to the world scroll distance represented by that row.
 * Bottom of screen = the world's current distance; up the screen = ahead.
 * @param {number} y screen y, virtual px
 * @param {number} height play-field height, virtual px
 * @param {number} distance world scroll distance, virtual px
 * @returns {number}
 */
function distanceForRow(y, height, distance) {
  return distance + (height - y);
}

export class Renderer {
  /**
   * @param {import("../engine/canvas.js").GameCanvas} gameCanvas
   */
  constructor(gameCanvas) {
    this.gameCanvas = gameCanvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = gameCanvas.ctx;
  }

  /**
   * Draw the whole scene for the current world state.
   * @param {import("../core/world.js").World} world
   */
  render(world) {
    this.gameCanvas.clear(palette.background);
    this.gameCanvas.applyTransform();
    this.drawRoad(world);
  }

  /**
   * Draw grass, shoulders, road body and lane dashes for the current scroll.
   * @param {import("../core/world.js").World} world
   */
  drawRoad(world) {
    const { ctx } = this;
    const W = world.width;
    const H = world.height;
    const distance = world.distance;
    const road = world.road;

    // Grass backdrop fills the whole field; road + shoulders paint over it.
    ctx.fillStyle = palette.grass;
    ctx.fillRect(0, 0, W, H);

    // --- Road body + shoulders, sliced into rows so curves follow the road. ---
    // AIDEV-NOTE: we draw bottom-up so newer (closer) rows are sampled at the
    // world's current distance; each row samples its own distance for the curve.
    for (let y = H; y > -ROW_HEIGHT; y -= ROW_HEIGHT) {
      const top = y - ROW_HEIGHT;
      const d = distanceForRow(y, H, distance);
      const s = road.sampleAt(d);

      const left = s.leftEdge;
      const right = s.rightEdge;
      const shoulder = s.shoulderWidth;

      // Grass shoulders (lighter strip right beside the asphalt).
      ctx.fillStyle = palette.grassEdge;
      ctx.fillRect(left - shoulder, top, shoulder, ROW_HEIGHT);
      ctx.fillRect(right, top, shoulder, ROW_HEIGHT);

      // Asphalt road body. Water sections tint blue (boat mode arrives later).
      ctx.fillStyle = s.water ? palette.water ?? "#1b6ca8" : palette.road;
      ctx.fillRect(left, top, right - left, ROW_HEIGHT);

      // Curb lines at the road edges.
      ctx.fillStyle = palette.roadEdge;
      ctx.fillRect(left - 2, top, 2, ROW_HEIGHT);
      ctx.fillRect(right, top, 2, ROW_HEIGHT);
    }

    this.drawLaneDashes(world);
  }

  /**
   * Draw scrolling dashed lane markers. Dashes are anchored to world distance
   * (not screen y) so they appear to flow toward the player as the road scrolls,
   * and they bend to follow the road's curve.
   * @param {import("../core/world.js").World} world
   */
  drawLaneDashes(world) {
    const { ctx } = this;
    const H = world.height;
    const distance = world.distance;
    const road = world.road;
    const cfg = world.config.road;

    const dash = cfg.markerDashLength;
    const gap = cfg.markerGapLength;
    const period = dash + gap;
    const laneCount = cfg.laneCount;

    ctx.fillStyle = palette.laneMarker;

    // Draw dashes by stepping in screen-space rows; a row is "on" when its world
    // distance falls in the dash portion of the dash+gap period.
    const step = 3;
    for (let y = H; y > 0; y -= step) {
      const d = distanceForRow(y, H, distance);
      // Position within the repeating dash/gap pattern.
      const phase = ((d % period) + period) % period;
      if (phase >= dash) continue; // in the gap

      const s = road.sampleAt(d);
      // Interior lane divider lines (skip the outer edges, those are curbs).
      for (let lane = 1; lane < laneCount; lane++) {
        const t = lane / laneCount;
        const x = s.leftEdge + t * s.width;
        ctx.fillRect(x - 1.5, y - step, 3, step);
      }
    }
  }
}

export default Renderer;
