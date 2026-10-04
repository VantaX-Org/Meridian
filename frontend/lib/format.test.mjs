/** Run: `node lib/format.test.mjs` — node's built-in assert, same pattern as eslint-rules/aurora-writing.test.mjs. */
import assert from "node:assert/strict";
import { checkClassLabel } from "./format.ts";

assert.equal(checkClassLabel("domain_value_check"), "Allowed values");
assert.equal(checkClassLabel("group_sum_check"), "Group total vs. limit");
assert.equal(checkClassLabel("older_than_days"), "Older than days");
assert.equal(checkClassLabel("toString"), "Tostring");
console.log("format.test: ok");
