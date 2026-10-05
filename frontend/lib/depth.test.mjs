/** Run: `node lib/depth.test.mjs` */
import assert from "node:assert/strict";
import { depthLevel } from "./depth.ts";

assert.equal(depthLevel("/"), 1);
assert.equal(depthLevel("/analyse/object/business_partner"), 3);
assert.equal(depthLevel("/workbench/record/42?tab=history"), 4);
assert.equal(depthLevel("/analyse"), null);
console.log("depth.test: ok");
