/** Run: `node lib/material-views.test.mjs` */
import assert from "node:assert/strict";
import { MAX_LEVELS, materialHref, PSTAT_VIEWS, levelLabel, matrixColumns, sumRuleCounts } from "./material-views.ts";

assert.equal(Object.keys(PSTAT_VIEWS).length, 14, "PSTAT has 14 letters");
assert.deepEqual(Object.keys(PSTAT_VIEWS).sort(), [..."ABCDEGKLPQSVXZ"]);
assert.equal(levelLabel("plant:1000"), "Plant 1000");
assert.equal(levelLabel("sales:2000/10"), "Sales org 2000, channel 10");
assert.equal(levelLabel("client"), "Client");

const lv = (n) => Array.from({ length: n }, (_, i) => ({ id: `plant:${i}`, kind: "plant", plant: String(i) }));
assert.equal(MAX_LEVELS, 12);
assert.equal(matrixColumns(lv(15), 15).shown.length, 12);
assert.equal(matrixColumns(lv(15), 15).note, "12 of 15 levels; filter by plant to see the rest");
assert.equal(matrixColumns(lv(5), 5).note, null);

const by = [
  { failing: [1, 2], passing_count: 10, not_evaluated: [1] },
  { failing: [], passing_count: 5, not_evaluated: [1, 2, 3] },
];
assert.deepEqual(sumRuleCounts(by), { failing: 2, passing: 15, notEvaluated: 4, total: 21 });
assert.equal(materialHref("material_master", "MATNR=000101|WERKS=1000"), "/analyse/material/000101");
assert.equal(materialHref("vendor_master", "MATNR=000101"), null);
assert.equal(materialHref("material_master", "WERKS=1000"), null);
console.log("material-views.test: ok");
