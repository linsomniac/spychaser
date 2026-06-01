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
    // Bullets paint under the vehicles; particles (muzzle/hit sparks) on top.
    if (world.projectiles) this.drawBullets(world.projectiles);
    if (world.hostiles) this.drawHostiles(world.hostiles);
    this.drawEntities(world);
    if (world.particles) world.particles.draw(this.ctx);
  }

  /**
   * Draw hostile projectiles: enemy bullets (orange slugs, travel down) and
   * rolling barrels (filled circles). (Phase 4.)
   * @param {import("../entities/projectiles.js").Projectiles} hostiles
   */
  drawHostiles(hostiles) {
    const { ctx } = this;
    hostiles.forEach((p) => {
      if (p.category === "barrel") {
        ctx.fillStyle = palette.barrel;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.barrelRim;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = palette.enemyBullet;
        ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      }
    });
  }

  /**
   * Draw the live machine-gun bullets. Each bullet carries a CENTER (x, y); we
   * paint a small bright slug in the bullet palette color. The pool's forEach is
   * allocation-free.
   * @param {import("../entities/projectiles.js").Projectiles} projectiles
   */
  drawBullets(projectiles) {
    const { ctx } = this;
    ctx.fillStyle = palette.bullet;
    projectiles.forEach((b) => {
      ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    });
  }

  /**
   * Draw the world's entities. For Phase 2 that is just the player car; later
   * phases collect enemies/civilians/projectiles here and draw them sorted by Y
   * (painter's order) so closer vehicles overlap farther ones.
   *
   * AIDEV-NOTE: Y-sort hook — push more drawables into `drawables`, sort by `y`,
   * then paint. Keep the player in this list so it sorts naturally with traffic.
   * @param {import("../core/world.js").World} world
   */
  drawEntities(world) {
    // AIDEV-NOTE: Y-sort all vehicles together so closer cars overlap farther
    // ones (painter's order). Player + enemies + civilians share the list.
    const drawables = [world.player];
    if (world.enemies) for (const e of world.enemies) drawables.push(e);
    if (world.civilians) for (const c of world.civilians) drawables.push(c);
    // Phase 7: bombs (and their blasts) sort with the ground traffic.
    if (world.bombs) for (const b of world.bombs) drawables.push(b);
    drawables.sort((a, b) => a.y - b.y);
    for (const ent of drawables) {
      if (ent && typeof ent.draw === "function") ent.draw(this.ctx);
    }
    // The helicopter is overhead — always draw it last, on top of everything.
    if (world.helicopter && typeof world.helicopter.draw === "function") {
      world.helicopter.draw(this.ctx);
    }
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

      if (s.water) {
        // --- Water section: a banked channel rather than asphalt. ---
        // AIDEV-NOTE: on water the "shoulders" are darker deep water (the banks
        // the boat must not run into) and the channel body is flat water with a
        // subtle horizontal wave band so it reads as moving. The boathouse
        // markers paint a wooden lintel across the channel at each end.
        ctx.fillStyle = palette.waterDeep;
        ctx.fillRect(left - shoulder, top, shoulder, ROW_HEIGHT);
        ctx.fillRect(right, top, shoulder, ROW_HEIGHT);

        ctx.fillStyle = palette.water;
        ctx.fillRect(left, top, right - left, ROW_HEIGHT);

        // Faint wave stripes: every other row band gets a lighter overlay.
        if (Math.floor(d / 24) % 2 === 0) {
          ctx.save();
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = palette.waterFoam;
          ctx.fillRect(left, top, right - left, ROW_HEIGHT);
          ctx.restore();
        }

        // Boathouse lintel: a wooden band across the channel at entry/exit.
        if (s.boathouse) {
          ctx.fillStyle = palette.boathouse;
          ctx.fillRect(left - shoulder, top, (right - left) + shoulder * 2, ROW_HEIGHT);
        }
      } else {
        // Grass shoulders (lighter strip right beside the asphalt).
        ctx.fillStyle = palette.grassEdge;
        ctx.fillRect(left - shoulder, top, shoulder, ROW_HEIGHT);
        ctx.fillRect(right, top, shoulder, ROW_HEIGHT);

        // Asphalt road body.
        ctx.fillStyle = palette.road;
        ctx.fillRect(left, top, right - left, ROW_HEIGHT);

        // Curb lines at the road edges.
        ctx.fillStyle = palette.roadEdge;
        ctx.fillRect(left - 2, top, 2, ROW_HEIGHT);
        ctx.fillRect(right, top, 2, ROW_HEIGHT);
      }
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
      if (s.water) continue; // no lane markings on a water channel
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
