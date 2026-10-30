#!/usr/bin/env node
/**
 * Token guard: raw hex colours, gradients and backdrop blur belong in the
 * token files only, and every padding, margin and gap of the interface
 * (design/v2 and app/) sits on the spacing grid: a --m2-s* token, a
 * layout token, or a calc() of them, never a raw px value.
 * lint-tokens.allow.txt stays empty.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ALLOW_FILE = join(ROOT, "scripts/lint-tokens.allow.txt");
// The v2 interface (design/v2) keeps its raw colour, shadow and motion in its own tokens file; the allowlist stays empty.
const TOKEN_FILES = new Set(["design/tokens.css", "design/v2/tokens.css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "public", "scripts", "e2e", "__tests__"]);
// Colour-pass allow sets live here, never in lint-tokens.allow.txt. The files that named the domain tokens
// (design/tokens.ts, DomainChip) and drew the glow (design/charts/Graph.tsx) left with the retired interface.
const DOMAIN_ALLOW = new Set();
// The spacing grid (DESIGN.md, Tokens; tokens.css "Spacing on a 4px grid"). Checked under design/v2 and app/ only.
const GRID_SCOPE = /^(?:design\/v2|app)\//;
const CSS_SPACING = /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap|padding-[a-z-]+|margin-[a-z-]+)\s*:\s*([^;}]*)/g;
const JS_SPACING = /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd)?\s*:\s*(?:-?[1-9]\d*(?=\s*[,}])|"[^"]*\b[1-9]\d*px[^"]*")/;
const TW_SPACING = /\b-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[\d+(?:\.\d+)?px\]/;
/** A raw px value in a spacing declaration's value, once the var() and calc() of tokens are taken out. */
const rawPx = (value) => /(?<![\w.-])[1-9]\d*(?:\.\d+)?px\b/.test(value.replace(/var\([^)]*\)/g, ""));

const RULES = [
  { name: "hex colour", re: /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/ },
  { name: "gradient", re: /\b(?:linear|radial|conic)-gradient\(|\bbg-(?:gradient|linear|radial)-/ },
  { name: "backdrop blur", re: /\bbackdrop-(?:blur|filter)\b/ },
  // Rule 13: shadows come from --m-elev-* only.
  { name: "box-shadow literal", re: /box-shadow\s*:[^;]*(?:#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:black|white)\b|var\(--m-elev-[\w-]+\s*,)/i },
  // Rule 15: no all-caps eyebrows.
  // Catches the CSS declaration, the Tailwind utility inside a className/class string (before or after
  // the attribute name), and `@apply uppercase`.
  { name: "text-transform uppercase", re: /^(?!.*::first-letter).*text-transform\s*:\s*uppercase|(?:className|class)=[^\n]*\buppercase\b|\buppercase\b(?=[^\n]*(?:className|class=|@apply))|@apply[^\n;]*\buppercase\b/ },
  // Rule 11: motion lives in design/tokens.css only.
  { name: "motion outside tokens.css", re: /\b(?:transition|animation)(?:-[a-z-]+)?\s*:|@keyframes\b/ },
  // Calm enterprise: no ember signal, no hero glow. Gradient tokens are functional ramps used by tokens.css classes only.
  { name: "retired ember or gradient token", re: /var\(--m-ember|var\(--m-grad-|var\(--m-elev-hero/ },
  { name: "glow", re: /var\(--m-elev-glow-|var\(--m-glow-/ },
  { name: "domain-literal", re: /var\(--m-dom-(?:material|customer|vendor|partner|finance|people|plant|asset|other)/, skip: DOMAIN_ALLOW },
  { name: "duration literal outside tokens.css", re: /\b\d*\.?\d+ms\b/ },
];

// Rule 14 and rule 6 read the CSS selector that owns each declaration.
// Status tones appear only on severity-marked elements (spec 6.2 rule 3).
const STATUS_USE = /var\(--m-(?:status-|critical|high|medium|low|pass)/;
const STATUS_OWNER = /\[data-(?:severity|tone|type|alignment)|\.m-pill-|\.m-badge-|\.m-row-severity-|\.m-heat-|\.m-btn-danger|\.m-field-error|\[aria-invalid|\[data-invalid/;
const OVERLAY = /\[data-overlay\]|\.m-lift|\.m-stat-link:hover|\.m-brand-card|\.m-popup|popover|menu|dialog|drawer|tooltip|modal|toast|palette|scrim|overlay|listbox|dropdown|combobox|panel|preview/i;
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
    if (GRID_SCOPE.test(file)) {
      if (file.endsWith(".css")) {
        for (const m of line.matchAll(CSS_SPACING)) if (rawPx(m[1])) add(i + 1, "spacing off the grid: use a --m2-s* token");
      } else if (JS_SPACING.test(line) || TW_SPACING.test(line)) add(i + 1, "spacing off the grid: use a --m2-s* token");
    }
  });
  if (file.endsWith(".css")) {
    for (const d of cssDecls(src)) {
      if (/--m-elev-[2-4]/.test(d.text) && !/^\s*--/.test(d.text) && !OVERLAY.test(d.sel)) add(d.line, "elevation 2-4 outside an overlay");
      if (STATUS_USE.test(d.text) && !/^\s*--/.test(d.text) && !STATUS_OWNER.test(d.sel)) add(d.line, "status colour without data-severity, data-tone or a pill, badge, severity or heat class");
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
  console.error(`\nlint:tokens failed: use --m-* tokens (see DESIGN.md).`);
  process.exit(1);
}
if (process.env.LINT_WARN) for (const w of warns) console.warn(`warn ${w}`);
console.log(`lint:tokens ok (${warns.length} warnings) (${allow.size} legacy files allowlisted)`);
