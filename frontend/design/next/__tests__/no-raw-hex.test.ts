import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const FRONTEND = join(__dirname, "../../..");
const ALLOWED = new Set(["tokens.css", "motion.css"]);
const SKIP = new Set(["__tests__", "node_modules", ".next"]);
const HEX = /#[0-9A-Fa-f]{3,8}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?)$/.test(n) && !ALLOWED.has(n)) out.push(p);
  }
  return out;
}

it("no raw hex colour under design/next or app/(next) outside the token files", () => {
  const hits: string[] = [];
  for (const root of ["design/next", "app/(next)"]) {
    for (const f of walk(join(FRONTEND, root))) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (HEX.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`); });
    }
  }
  expect(hits).toEqual([]);
});
