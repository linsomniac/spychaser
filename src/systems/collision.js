// systems/collision.js
//
// Axis-aligned bounding-box (AABB) collision. A two-stage broad/narrow phase
// over world entity groups: collidePairs() walks two groups, skips inactive
// entities and (optionally) category-filtered pairs in the broad phase, then
// does the precise AABB test in the narrow phase and reports each hit via a
// callback. Pure, canvas-free, deterministic — unit-tested in test/collision.
//
// AIDEV-NOTE: An AABB is {x, y, w, h} with (x,y) as the TOP-LEFT corner (NOT a
// center). Entities expose this via a `bounds` accessor (see player.bounds).
// Edge-touching boxes (shared edge, zero overlap area) are treated as NOT
// colliding — the comparisons are strict (<). This avoids spurious hits when a
// bullet's far edge exactly grazes a target.

/**
 * Precise AABB overlap test. Strict inequalities so a shared edge (touching but
 * not overlapping) returns false.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {boolean}
 */
export function aabbOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/**
 * Overlap test for two entities that each expose a `.bounds` AABB.
 * @param {{bounds:object}} entA
 * @param {{bounds:object}} entB
 * @returns {boolean}
 */
export function boundsOverlap(entA, entB) {
  return aabbOverlap(entA.bounds, entB.bounds);
}

// AIDEV-NOTE: An entity is "inactive" only when it explicitly carries
// `active === false`. Entities without an `active` field are considered live so
// that plain test fixtures and simple entities don't need to opt in.
function isInactive(ent) {
  return ent.active === false;
}

/**
 * Broad/narrow phase over two entity groups. For every live (a, b) where a is in
 * groupA and b is in groupB:
 *   1. Broad phase: skip if either is inactive, or if `filter(a,b)` is provided
 *      and returns falsy.
 *   2. Narrow phase: skip if their bounds do not overlap.
 *   3. Otherwise invoke `onHit(a, b)`.
 *
 * If `onHit` returns a truthy value, `a` is considered "consumed" and is not
 * tested against any remaining entities in groupB (e.g. a bullet that hits one
 * target stops there). This lets callers express one-shot collisions cleanly.
 *
 * @param {Array<{bounds:object,active?:boolean}>} groupA
 * @param {Array<{bounds:object,active?:boolean}>} groupB
 * @param {(a:object, b:object) => (boolean|void)} onHit
 * @param {(a:object, b:object) => boolean} [filter] optional category gate.
 */
export function collidePairs(groupA, groupB, onHit, filter) {
  for (let i = 0; i < groupA.length; i++) {
    const a = groupA[i];
    if (isInactive(a)) continue;
    for (let j = 0; j < groupB.length; j++) {
      const b = groupB[j];
      if (isInactive(b)) continue;
      if (filter && !filter(a, b)) continue;
      if (!boundsOverlap(a, b)) continue;
      const consumed = onHit(a, b);
      if (consumed) break; // a is spent; stop testing it against further b's.
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — helicopter (missile-only) + bomb blasts.
// ---------------------------------------------------------------------------

/**
 * Circle-vs-AABB overlap (closest-point test). Used for bomb blasts. The circle
 * is a center + radius; the box is a top-left AABB {x,y,w,h}.
 * @param {number} cx circle center x
 * @param {number} cy circle center y
 * @param {number} r circle radius
 * @param {{x:number,y:number,w:number,h:number}} box top-left AABB
 * @returns {boolean}
 */
export function circleOverlapsBounds(cx, cy, r, box) {
  // Clamp the circle center to the box to find the nearest point on the box.
  const nx = cx < box.x ? box.x : cx > box.x + box.w ? box.x + box.w : cx;
  const ny = cy < box.y ? box.y : cy > box.y + box.h ? box.y + box.h : cy;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// AIDEV-NOTE: The Mad Bomber helicopter is MISSILE-ONLY (spec §6). Machine-gun
// bullets pass straight THROUGH it: they are neither consumed nor do damage.
// Only projectiles flagged as missiles (category "playerMissile" or kind
// "missile") hit it — they are consumed and routed to heli.missileHit(), which
// owns the hp/death/LEAVING transition. This keeps the immunity rule in ONE
// place rather than scattered through the world's collision pass.
function isMissile(p) {
  return p.category === "playerMissile" || p.kind === "missile";
}

/**
 * Resolve player projectiles vs the helicopter. Bullets are ignored (immune);
 * missiles that overlap the heli are consumed (active=false) and applied via
 * missileHit(). Returns the list of hit pairs.
 * @param {Array<{bounds:object,active?:boolean,damage?:number}>} projectiles
 * @param {{bounds:object,active:boolean,missileHit:(n:number)=>boolean}|null} heli
 * @returns {Array<{projectile:object,helicopter:object}>}
 */
export function resolveMissilesVsHelicopter(projectiles, heli) {
  const hits = [];
  if (!heli || heli.active === false || heli.dead) return hits;
  for (const p of projectiles) {
    if (p.active === false) continue;
    if (!isMissile(p)) continue; // bullets pass through (immune heli)
    if (!aabbOverlap(p.bounds, heli.bounds)) continue;
    p.active = false; // consume the missile
    heli.missileHit(p.damage ?? 1);
    hits.push({ projectile: p, helicopter: heli });
    if (heli.dead) break;
  }
  return hits;
}

/**
 * Apply detonated bomb blasts to a set of targets. A bomb only blasts once it
 * has `detonated`, and each bomb's blast is applied at most once (blastApplied
 * guard). Targets within the circular blast radius are returned as hit pairs;
 * the caller decides the consequence (player damage). Targets expose `.bounds`.
 * @param {Array<{detonated:boolean,blastApplied:boolean,blast:()=>({x:number,y:number,r:number}|null)}>} bombs
 * @param {Array<{bounds:object,active?:boolean}>} targets
 * @returns {Array<{bomb:object,target:object}>}
 */
export function resolveBombBlast(bombs, targets) {
  const hits = [];
  for (const b of bombs) {
    if (!b.detonated || b.blastApplied) continue;
    const circle = b.blast();
    if (!circle) continue;
    b.blastApplied = true;
    for (const t of targets) {
      if (!t || t.active === false) continue;
      if (circleOverlapsBounds(circle.x, circle.y, circle.r, t.bounds)) {
        hits.push({ bomb: b, target: t });
      }
    }
  }
  return hits;
}

export default collidePairs;
