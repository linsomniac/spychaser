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

export default collidePairs;
