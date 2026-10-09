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
const TOKEN_FILES = new Set(["design/tokens.css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "public", "scripts", "e2e", "__tests__"]);
const RULES = [
  { name: "hex colour", re: /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/ },
  { name: "gradient", re: /\b(?:linear|radial|conic)-gradient\(|\bbg-(?:gradient|linear|radial)-/ },
  { name: "backdrop blur", re: /\bbackdrop-(?:blur|filter)\b/ },
  // Rule 13: shadows come from --aurora-elev-* only.
  { name: "box-shadow literal", re: /box-shadow\s*:[^;]*(?:#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:black|white)\b|var\(--aurora-elev-[\w-]+\s*,)/i },
  // Rule 15: no all-caps eyebrows.
  // Catches the CSS declaration, the Tailwind utility inside a className/class string (before or after
  // the attribute name), and `@apply uppercase`.
  { name: "text-transform uppercase", re: /^(?!.*::first-letter).*text-transform\s*:\s*uppercase|(?:className|class)=[^\n]*\buppercase\b|\buppercase\b(?=[^\n]*(?:className|class=|@apply))|@apply[^\n;]*\buppercase\b/ },
  // Rule 11: motion lives in the Aurora style files only.
  { name: "motion outside aurora css", re: /\b(?:transition|animation)(?:-[a-z-]+)?\s*:|@keyframes\b/, skip: new Set(["app/styles/aurora.css", "app/styles/aurora-components.css"]) },
  { name: "duration literal outside aurora.css", re: /\b\d*\.?\d+ms\b/, skip: new Set(["app/styles/aurora.css"]) },
];

// Rule 14 and rule 6 read the CSS selector that owns each declaration.
const OVERLAY = /\[data-overlay\]|popover|menu|dialog|drawer|tooltip|modal|toast|palette|scrim|overlay|listbox|dropdown|combobox|panel|preview/i;
function* cssDecls(src) {
  let sel = "", depth = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const open = t.indexOf("{");
    if (open >= 0 && !t.includes("}")) { depth.push(sel + t.slice(0, open)); sel = ""; continue; }
    if (open >= 0) { yield { line: i + 1, text: t, sel: t.slice(0, open) }; continue; }
    if (t.includes("}")) { depth.pop(); sel = ""; continue; }
    if (/[:]/.test(t) && depth.length) yield { line: i + 1, text: t, sel: depth.join(" ") };
    else if (!depth.length || t.trim().endsWith(",")) sel += t;
  }
}

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
const warns = [];
for (const abs of walk(ROOT)) {
  const file = relative(ROOT, abs);
  if (TOKEN_FILES.has(file)) continue;
  const src = readFileSync(abs, "utf8");
  const add = (n, name) => (hits.get(file) ?? hits.set(file, []).get(file)).push(`${file}:${n}  ${name}`);
  src.split("\n").forEach((line, i) => {
    for (const r of RULES) if (!r.skip?.has(file) && r.re.test(line)) add(i + 1, r.name);
  });
  if (file.endsWith(".css") && file !== "app/styles/aurora.css") {
    for (const d of cssDecls(src)) {
      if (/--aurora-elev-[2-4]/.test(d.text) && !/^\s*--/.test(d.text) && !OVERLAY.test(d.sel)) add(d.line, "elevation 2-4 outside an overlay");
      if (/var\(--aurora-status-/.test(d.text) && !/\[data-(?:severity|tone)/.test(d.sel)) warns.push(`${file}:${d.line}  status colour without [data-severity] or [data-tone]`);
    }
  }
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
if (process.env.LINT_WARN) for (const w of warns) console.warn(`warn ${w}`);
console.log(`lint:tokens ok (${warns.length} warnings) (${allow.size} legacy files allowlisted)`);
