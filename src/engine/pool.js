// engine/pool.js
//
// Generic object pool. Arcade gameplay churns through short-lived objects
// (bullets, debris, enemies). Allocating/GC-ing them every frame causes
// jank, so we recycle instances instead.
//
// AIDEV-NOTE: `acquire()` returns a *reset* object that is considered "live".
// `release(obj)` returns it to the free list. Callers must not keep using an
// object after releasing it. The pool never shrinks; `free.length` is the
// high-water mark of idle objects.

/**
 * @template T
 */
export class Pool {
  /**
   * @param {() => T} factory   Creates a brand-new object when the pool is empty.
   * @param {(obj: T) => void} [reset]  Resets an object to a clean state before reuse.
   * @param {number} [prealloc=0]  Number of objects to allocate up front.
   */
  constructor(factory, reset = () => {}, prealloc = 0) {
    if (typeof factory !== "function") {
      throw new TypeError("Pool requires a factory function");
    }
    /** @type {() => T} */
    this._factory = factory;
    /** @type {(obj: T) => void} */
    this._reset = reset;
    /** @type {T[]} free list of idle objects */
    this._free = [];
    /** number of objects currently handed out via acquire() */
    this._liveCount = 0;
    /** total objects ever created by the factory */
    this._created = 0;

    for (let i = 0; i < prealloc; i++) {
      this._created++;
      this._free.push(this._factory());
    }
  }

  /** @returns {number} objects currently checked out */
  get liveCount() {
    return this._liveCount;
  }

  /** @returns {number} idle objects available for reuse */
  get freeCount() {
    return this._free.length;
  }

  /** @returns {number} total objects the factory has produced */
  get createdCount() {
    return this._created;
  }

  /**
   * Get an object from the pool, reusing a freed one if available.
   * The returned object has been passed through `reset`.
   * @returns {T}
   */
  acquire() {
    let obj;
    if (this._free.length > 0) {
      obj = /** @type {T} */ (this._free.pop());
    } else {
      this._created++;
      obj = this._factory();
    }
    this._reset(obj);
    this._liveCount++;
    return obj;
  }

  /**
   * Return an object to the pool.
   * @param {T} obj
   */
  release(obj) {
    this._free.push(obj);
    if (this._liveCount > 0) {
      this._liveCount--;
    }
  }

  /**
   * Drop all idle objects (does not touch live ones). Live count is unaffected.
   */
  clear() {
    this._free.length = 0;
  }
}
