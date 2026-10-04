#!/usr/bin/env node
/**
 * Token guard: raw hex colours, gradients and backdrop blur belong in the
 * token files only. Files that predate the redesign are listed in
 * lint-tokens.allow.txt; remove a line when its file is migrated.
 * `--write-allowlist` regenerates that list from the current violations.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ALLOW_FILE = join(ROOT, "scripts/lint-tokens.allow.txt");
const TOKEN_FILES = new Set([
  "app/styles/aurora.css",
  "app/globals.css",
  "lib/aurora/tokens.ts",
  "components/aurora/data/chart-theme.ts",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "public", "scripts", "e2e", "__tests__"]);
const RULES = [
  { name: "hex colour", re: /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/ },
  { name: "gradient", re: /\b(?:linear|radial|conic)-gradient\(|\bbg-(?:gradient|linear|radial)-/ },
  { name: "backdrop blur", re: /\bbackdrop-(?:blur|filter)\b/ },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) yield* walk(join(dir, e.name)); }
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) yield join(dir, e.name);
  }
}

const allow = new Set(
  readFileSync(ALLOW_FILE, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")),
);
const hits = new Map();
for (const abs of walk(ROOT)) {
  const file = relative(ROOT, abs);
  if (TOKEN_FILES.has(file)) continue;
  readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) (hits.get(file) ?? hits.set(file, []).get(file)).push(`${file}:${i + 1}  ${r.name}`);
  });
}

if (process.argv.includes("--write-allowlist")) {
  const header = "# Files allowed to hold raw colour, gradient or blur until migrated to ui-core.\n# Delete a line when its file is clean. Never add one.\n";
  writeFileSync(ALLOW_FILE, header + [...hits.keys()].sort().join("\n") + "\n");
  console.log(`lint:tokens wrote ${hits.size} legacy files`);
  process.exit(0);
}

const bad = [...hits].filter(([f]) => !allow.has(f)).flatMap(([, l]) => l);
const stale = [...allow].filter((f) => !hits.has(f));
for (const l of bad) console.error(l);
if (stale.length) console.error(`\nClean now, remove from lint-tokens.allow.txt:\n  ${stale.join("\n  ")}`);
if (bad.length || stale.length) {
  console.error(`\nlint:tokens failed: use --aurora-* tokens (see DESIGN.md).`);
  process.exit(1);
}
console.log(`lint:tokens ok (${allow.size} legacy files allowlisted)`);
