// systems/separation.js
//
// Unified vehicle overlap resolution (spec 2026-06-10). One pure, RNG-free pass
// over ALL on-road vehicles (player, vans, enemies, civilians) that prevents them
// from overlapping. Lateral-only (x); vertical spacing comes from differing
// approachSpeeds. Replaces the old soft, enemy-only `separateEnemies` nudge.
//
// AIDEV-NOTE: movability model. Each body is "immovable" (player + weapons van)
// or movable (enemies, civilians). For an overlapping pair: two immovable bodies
// are left alone (this no-op is what keeps the player able to sit in the van's
// rear ramp to load a special); an immovable + movable pair pushes the movable
// one fully out; two movable bodies split the penetration. Resolving exactly the
// penetration settles a pair to a `marginX` lateral gap. The World runs this AFTER
// its damage/ram pass so a ram still registers before cars are shoved apart.

/**
 * Resolve lateral overlaps among vehicle bodies in place (mutates body.x).
 * @param {Array<{x:number,y:number,width:number,height:number}>} bodies
 * @param {object} [opts]
 * @param {number} [opts.marginX=0] lateral slack added to the overlap test / gap
 * @param {number} [opts.marginY=0] vertical slack for the band-overlap test
 * @param {(b:object)=>boolean} [opts.immovable] true => never pushed (player/van)
 * @param {(x:number, b:object)=>number} [opts.clampX] keep a pushed body on-road
 */
export function resolveOverlaps(bodies, opts = {}) {
  const marginX = opts.marginX ?? 0;
  const marginY = opts.marginY ?? 0;
  const immovable = opts.immovable ?? (() => false);
  const clampX = opts.clampX ?? ((x) => x);
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + marginY) continue;
      const pen = (a.width + b.width) / 2 + marginX - Math.abs(a.x - b.x);
      if (pen <= 0) continue;
      const ai = immovable(a);
      const bi = immovable(b);
      if (ai && bi) continue;
      // Lower index (a) goes left on an exact tie — deterministic.
      const dir = a.x === b.x ? -1 : Math.sign(a.x - b.x);
      if (ai) {
        b.x = clampX(b.x - dir * pen, b);
      } else if (bi) {
        a.x = clampX(a.x + dir * pen, a);
      } else {
        a.x = clampX(a.x + dir * (pen / 2), a);
        b.x = clampX(b.x - dir * (pen / 2), b);
      }
    }
  }
}

export default resolveOverlaps;
