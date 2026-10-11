#!/usr/bin/env node
/**
 * Contrast guard: parses design/tokens.css and checks WCAG contrast >= 4.5
 * for every ink/surface and status/soft pair in both themes. Exits 1 on failure.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../design/tokens.css", import.meta.url), "utf8");
const block = (open) => {
  const start = css.indexOf(open);
  if (start < 0) throw new Error(`block not found: ${open}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
};
const decls = (body) => Object.fromEntries([...body.matchAll(/(--m-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = decls(block(":root {"));
const themes = { light, dark: { ...light, ...decls(block('[data-theme="dark"] {')) } };

function resolve(vars, name, depth = 0) {
  let v = vars[name];
  if (v === undefined || depth > 8) throw new Error(`unresolved ${name}`);
  const ref = v.match(/^var\((--m-[\w-]+)\)$/);
  return ref ? resolve(vars, ref[1], depth + 1) : v;
}
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lum(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const status = ["critical", "high", "medium", "pass"];
const pairs = [
  ...["ink", "ink-2", "ink-3"].flatMap((i) => ["sheet", "canvas", "sheet-raised"].map((s) => [i, s])),
  ["ink", "sheet-sunken"],
  ["ink-on-accent", "accent"],
  ["accent", "sheet"], ["accent", "canvas"],
  ["accent-ink", "accent-soft"], ["accent", "accent-soft"], ["accent-ink", "accent-soft-2"],
  ...status.flatMap((s) => [[s, "sheet"], [s, `${s}-soft`], [`${s}-ink`, `${s}-soft`]]),
];

let fail = 0;
for (const [theme, vars] of Object.entries(themes)) {
  for (const [fg, bg] of pairs) {
    const r = ratio(resolve(vars, `--m-${fg}`), resolve(vars, `--m-${bg}`));
    const ok = r >= 4.5;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}`);
  }
}
console.log(fail ? `check-contrast: ${fail} pair(s) below 4.5:1` : `check-contrast: ${pairs.length * 2} pairs ok`);
process.exit(fail ? 1 : 0);
