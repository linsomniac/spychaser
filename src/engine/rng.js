// engine/rng.js
//
// Deterministic pseudo-random number generator. We use mulberry32: a tiny,
// fast, well-distributed 32-bit PRNG. Determinism matters because the spawn
// director, road generation, and tests all need reproducible sequences from a
// known seed.
//
// AIDEV-NOTE: mulberry32 must use the exact bit operations below. The `>>> 0`
// coercions keep the internal state an unsigned 32-bit integer; dropping any of
// them silently changes the sequence (and breaks reproducibility/tests).

/**
 * @typedef {Object} Rng
 * @property {() => number} next      Float in [0, 1).
 * @property {(min: number, max: number) => number} range  Float in [min, max).
 * @property {(min: number, max: number) => number} int    Integer in [min, max] inclusive.
 * @property {<T>(arr: ReadonlyArray<T>) => T} pick         Random element of arr.
 * @property {() => number} seed      The (current) raw seed/state value.
 */

/**
 * Normalize an arbitrary seed value to an unsigned 32-bit integer.
 * @param {number} seed
 * @returns {number}
 */
function toUint32(seed) {
  // `| 0` then `>>> 0` collapses NaN/floats/negatives into a stable uint32.
  return (seed | 0) >>> 0;
}

/**
 * Create a seeded RNG.
 * @param {number} [seed=1] integer seed.
 * @returns {Rng}
 */
export function createRng(seed = 1) {
  let state = toUint32(seed);

  /** @returns {number} float in [0, 1) */
  function next() {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function range(min, max) {
    return min + next() * (max - min);
  }

  /**
   * Integer in [min, max], inclusive of both ends.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function int(min, max) {
    // AIDEV-NOTE: inclusive on both ends. Math.floor(next() * span) yields
    // 0..(span-1); +min shifts it to min..max.
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  /**
   * Pick a random element from a non-empty array.
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @returns {T}
   */
  function pick(arr) {
    if (arr.length === 0) {
      throw new RangeError("pick() requires a non-empty array");
    }
    return arr[Math.floor(next() * arr.length)];
  }

  return {
    next,
    range,
    int,
    pick,
    seed: () => state,
  };
}
