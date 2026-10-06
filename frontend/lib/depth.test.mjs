/** Run: `node lib/depth.test.mjs` */
import assert from "node:assert/strict";
import { DEPTH_ROUTES, depthLevel } from "./depth.mjs";

assert.equal(depthLevel("/"), 1);
assert.equal(depthLevel("/analyse/object/business_partner"), 3);
assert.equal(depthLevel("/workbench/record/42?tab=history"), 4);
assert.equal(depthLevel("/analyse"), null);
assert.equal(depthLevel("/analyse/coverage?object=material_master"), 2);
assert.equal(depthLevel("/analyse/rule/MM551"), 3);
assert.equal(Object.keys(DEPTH_ROUTES).length, 10);
console.log("depth.test: ok");
