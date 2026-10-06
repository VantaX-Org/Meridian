/** Run: `node lib/mm-views.test.mjs` */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "mm-views.ts"), "utf8");
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
console.log("mm-views.test: ok");
