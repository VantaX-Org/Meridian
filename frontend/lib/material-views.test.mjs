/** Run: `node lib/material-views.test.mjs` */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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


const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "material-views.ts"), "utf8");
const views = [...src.matchAll(/\{ id: "(\w+)", label: "[^"]+", tables: \[([^\]]*)\]/g)]
  .map((m) => ({ id: m[1], tables: [...m[2].matchAll(/"(\w+)"/g)].map((t) => t[1]) }));
assert.equal(views.length, 13);
assert.equal(new Set(views.map((v) => v.id)).size, 13);

const dict = join(here, "../../sap/dictionaries/ecc6");
const missing = readFileSync(join(dict, "MISSING.txt"), "utf8");
for (const t of new Set(views.flatMap((v) => v.tables))) {
  assert.ok(existsSync(join(dict, "tables", `${t}.json`)) || missing.includes(t), `${t} is not in the SAP dictionary`);
}

// the API's view map must name the same views
const yaml = readFileSync(join(here, "../../checks/views/material_master.yaml"), "utf8");
const ids = [...yaml.matchAll(/^- id: (\w+)/gm)].map((m) => m[1]);
assert.deepEqual(ids, views.map((v) => v.id));
console.log("material-views.test: ok");
