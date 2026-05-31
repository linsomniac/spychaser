// data/palette.js
//
// Modern flat-vector palette for Spy Chaser. Flat fills, a few accents, high
// contrast against the dark road. All colors are CSS color strings so they can
// be dropped straight into Canvas 2D fill/stroke styles.
//
// AIDEV-NOTE: Keep this file framework-free and side-effect-free. It is imported
// by both the renderer and (potentially) tests, so it must not touch the DOM.

export const palette = Object.freeze({
  // Backdrop / framing.
  background: "#0b0f1a", // deep navy beyond the road (canvas clear color)
  grass: "#16321f", // verge / off-road shoulders
  grassEdge: "#1f4a2c", // lighter strip where shoulder meets road

  // Road surface.
  road: "#23262e", // asphalt
  roadEdge: "#3a3f4b", // curb / outer road line
  laneMarker: "#e8c547", // dashed center/lane lines (warm yellow)
  water: "#1b6ca8", // water sections (boat mode); flat blue

  // Player.
  player: "#37c2ff", // hero car body (cyan-blue)
  playerAccent: "#bdeaff", // canopy / glass highlight
  playerExhaust: "#ff8a3d", // boost flame

  // Enemies.
  enemy: "#ff4d6d", // standard enemy car (vivid pink-red)
  enemyHeavy: "#9b5de5", // armored / heavy variant (purple)
  enemyAccent: "#2a1620", // enemy window/shadow detail

  // Projectiles & effects.
  bullet: "#ffe66d", // player bullets (bright yellow)
  enemyBullet: "#ff7b54", // enemy bullets (orange)
  special: "#00e5a8", // special weapon / EMP tint (teal)
  explosion: "#ffb142", // explosion core
  explosionEdge: "#ff5e3a", // explosion rim
  smoke: "#4a4f5c", // debris / smoke puffs

  // Pickups.
  pickup: "#7CFF6B", // generic pickup (green)
  pickupRing: "#d7ffcf", // pickup glow ring

  // HUD / UI.
  hudText: "#f2f5ff", // primary HUD text
  hudDim: "#8a93a6", // secondary HUD text
  hudPanel: "rgba(11, 15, 26, 0.72)", // translucent HUD backing
  hudAccent: "#37c2ff", // HUD highlights (matches player)
  danger: "#ff4d6d", // low-health / warning
  success: "#7CFF6B", // positive feedback
});

export default palette;
