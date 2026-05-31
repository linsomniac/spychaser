import { test } from "node:test";
import assert from "node:assert/strict";

import { Pool } from "../src/engine/pool.js";

test("pool: factory is required", () => {
  // @ts-expect-error testing runtime guard
  assert.throws(() => new Pool(null), TypeError);
});

test("pool: prealloc creates idle objects without making them live", () => {
  let made = 0;
  const p = new Pool(
    () => ({ id: made++ }),
    () => {},
    5,
  );
  assert.equal(p.freeCount, 5);
  assert.equal(p.liveCount, 0);
  assert.equal(p.createdCount, 5);
});

test("pool: acquire reuses freed objects instead of allocating", () => {
  let made = 0;
  const p = new Pool(() => ({ id: made++ }));
  const a = p.acquire();
  assert.equal(p.liveCount, 1);
  assert.equal(p.createdCount, 1);

  p.release(a);
  assert.equal(p.liveCount, 0);
  assert.equal(p.freeCount, 1);

  const b = p.acquire();
  assert.equal(b, a, "should have reused the same instance");
  assert.equal(p.createdCount, 1, "should not have created a new object");
});

test("pool: acquire creates a new object when the free list is empty", () => {
  let made = 0;
  const p = new Pool(() => ({ id: made++ }));
  const a = p.acquire();
  const b = p.acquire();
  assert.notEqual(a, b);
  assert.equal(p.createdCount, 2);
  assert.equal(p.liveCount, 2);
});

test("pool: reset runs on acquire", () => {
  const p = new Pool(
    () => ({ x: 0, used: true }),
    (o) => {
      o.x = 0;
      o.used = false;
    },
  );
  const a = p.acquire();
  a.x = 99;
  a.used = true;
  p.release(a);
  const b = p.acquire();
  assert.equal(b, a);
  assert.equal(b.x, 0, "reset should have cleared x");
  assert.equal(b.used, false, "reset should have cleared used");
});

test("pool: liveCount never goes below zero on extra release", () => {
  const p = new Pool(() => ({}));
  const a = p.acquire();
  p.release(a);
  p.release(a); // erroneous double release
  assert.equal(p.liveCount, 0);
});

test("pool: clear drops idle objects but keeps live ones", () => {
  const p = new Pool(() => ({}), () => {}, 3);
  const a = p.acquire();
  assert.equal(p.liveCount, 1);
  assert.equal(p.freeCount, 2);
  p.clear();
  assert.equal(p.freeCount, 0);
  assert.equal(p.liveCount, 1);
});
