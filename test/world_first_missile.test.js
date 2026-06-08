// test/world_first_missile.test.js
//
// Guaranteed first missiles (spec §4.5): the first van delivery in a run is
// always "missiles" so the player can engage the first helicopter; later loads
// stay random. We drop the player into a van's ramp and step one tick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/core/world.js";
import { createWeaponsVan, rampZone } from "../src/entities/weaponsVan.js";

/** Place a 1-frame van so its rear ramp sits over the player, then step once. */
function deliverOnce(w) {
  const van = createWeaponsVan(w.player.x, 0, { config: w.config, loadFrames: 1 });
  // Position the van so its rear-ramp band overlaps the player's body.
  van.y = w.player.y - (van.height / 2 - van.def.rampHeight / 2);
  w.vans.push(van);
  w.setInput({});
  w.update(w.config.FIXED_STEP);
  return w.player.special;
}

test("the first van delivery of a run is always missiles", () => {
  const w = new World({ seed: 13 });
  assert.equal(w._firstSpecialDelivered, false);
  const special = deliverOnce(w);
  assert.ok(special, "a special was delivered");
  assert.equal(special.kind, "missiles", "first delivery is missiles");
  assert.equal(w._firstSpecialDelivered, true);
});

test("reset re-arms the first-missile guarantee", () => {
  const w = new World({ seed: 13 });
  deliverOnce(w);
  assert.equal(w._firstSpecialDelivered, true);
  w.reset();
  assert.equal(w._firstSpecialDelivered, false);
});
