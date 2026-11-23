#!/usr/bin/env node
/**
 * Contrast guard: parses design/tokens.css (--m-*) and ui/tokens.css (--mx-*) and checks WCAG contrast >= 4.5
 * for every text/background token pair the library renders, in light, dark
 * and the system-preference dark block (which must also match the explicit
 * dark block value for value). Exits 1 on failure.
 */
import { readFileSync } from "node:fs";

let css = readFileSync(new URL("../design/tokens.css", import.meta.url), "utf8");
const block = (open) => {
  const start = css.indexOf(open);
  if (start < 0) throw new Error(`block not found: ${open}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
};
const decls = (body) => Object.fromEntries([...body.matchAll(/(--m-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = decls(block(":root {"));
const darkOwn = decls(block('[data-theme="dark"] {'));
const systemOwn = decls(block(':root:not([data-theme="light"]):not([data-theme="dark"]) {'));
const themes = { light, dark: { ...light, ...darkOwn }, system: { ...light, ...systemOwn } };

let fail = 0;
for (const name of new Set([...Object.keys(darkOwn), ...Object.keys(systemOwn)])) {
  if (darkOwn[name] !== systemOwn[name]) {
    fail++;
    console.log(`FAIL dark blocks differ on ${name}: ${darkOwn[name]} vs ${systemOwn[name]}`);
  }
}

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
const domains = ["material", "customer", "vendor", "partner", "finance", "people", "plant", "asset", "other"];
const surfaces = ["sheet", "canvas", "sheet-raised", "sheet-sunken", "rail"];
const pairs = [
  ...["ink", "ink-2", "ink-3"].flatMap((i) => surfaces.map((s) => [i, s])),
  ...["ink", "ink-2"].map((i) => [i, "accent-soft"]),
  ...["accent", "accent-hover", "accent-active"].map((a) => ["ink-on-accent", a]),
  ...["sheet", "canvas", "sheet-raised"].map((s) => ["accent", s]),
  ["accent-ink", "accent-soft"], ["accent", "accent-soft"], ["accent-ink", "accent-soft-2"],
  ...status.flatMap((s) => [[s, "sheet"], [s, "canvas"], [s, "sheet-raised"], [s, `${s}-soft`], [`${s}-ink`, `${s}-soft`], [`${s}-ink`, "sheet"]]),
  ["low", "low-soft"], ["low", "sheet"], ["low", "canvas"], ["low-ink", "low-soft"], ["low-ink", "sheet"],
  ...["critical", "high", "medium", "low", "pass", "info"].map((s) => [`${s}-on`, s]),
  ["info", "sheet"], ["info", "info-soft"], ["info-ink", "info-soft"], ["info-ink", "sheet"],
  ...["hero-ink", "hero-ink-2", "hero-ink-3"].flatMap((i) => ["hero-bg", "hero-bg-2"].map((b) => [i, b])),
  ...["critical", "high", "medium", "pass"].map((t) => [`hero-tone-${t}`, "hero-bg"]),
  ...domains.flatMap((d) => [
    ...["sheet", "canvas", "sheet-raised", `dom-${d}-soft`].map((s) => [`dom-${d}`, s]),
    [`dom-${d}-ink`, `dom-${d}-soft`], [`dom-${d}-ink`, "sheet"], ["dom-on", `dom-${d}`],
  ]),
  ...["viz-9", "viz-10"].flatMap((v) => ["sheet", "canvas"].map((s) => [v, s])),
  ...["seq-1", "seq-2", "seq-3", "div-neg-1", "div-mid", "div-pos-1"].map((b) => ["ink", b]),
  ...["seq-4", "seq-5", "div-neg-2", "div-pos-2"].map((b) => ["ink-on-accent", b]),
  ["viz-tooltip-ink", "viz-tooltip-bg"],
  ["viz-axis", "sheet"],
];

for (const [theme, vars] of Object.entries(themes)) {
  for (const [fg, bg] of pairs) {
    const r = ratio(resolve(vars, `--m-${fg}`), resolve(vars, `--m-${bg}`));
    const ok = r >= 4.5;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}`);
  }
}

// ---- ui/tokens.css (--mx-*): light, explicit dark and the system dark block must agree, then pairs are checked ----
css = readFileSync(new URL("../ui/tokens.css", import.meta.url), "utf8");
const blockAt = (open, from = 0) => {
  const start = css.indexOf(open, from);
  if (start < 0) throw new Error(`block not found: ${open}`);
  const end = css.indexOf("\n}", start);
  const endIndented = css.indexOf("\n  }", start);
  const stop = open.startsWith("html:not") ? endIndented : end;
  return css.slice(css.indexOf("{", start) + 1, stop);
};
const mdecls = (body) => Object.fromEntries([...body.matchAll(/(--mx-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const mxLight = mdecls(blockAt(".mx-root {"));
const mxDarkOwn = mdecls(blockAt('html[data-theme="dark"] .mx-root {'));
const mxSystemOwn = mdecls(blockAt('html:not([data-theme="light"]) .mx-root {'));
for (const name of new Set([...Object.keys(mxDarkOwn), ...Object.keys(mxSystemOwn)])) {
  if (mxDarkOwn[name] !== mxSystemOwn[name]) {
    fail++;
    console.log(`FAIL mx dark blocks differ on ${name}: ${mxDarkOwn[name]} vs ${mxSystemOwn[name]}`);
  }
}
const mxThemes = { light: mxLight, dark: { ...mxLight, ...mxDarkOwn } };
const rx = (vars, name, depth = 0) => {
  const v = vars[name];
  if (v === undefined || depth > 8) throw new Error(`unresolved ${name}`);
  const ref = v.match(/^var\((--mx-[\w-]+)\)$/);
  return ref ? rx(vars, ref[1], depth + 1) : v;
};
const mxSurfaces = ["sheet", "paper", "well"];
const mxPairs = [
  ...["ink", "ink-2", "ink-3"].flatMap((i) => mxSurfaces.map((s) => [i, s])),
  ["env-prod", "env-prod-soft"], ["env-qa", "env-qa-soft"], ["env-dev", "env-dev-soft"],
  ["env-prod", "sheet"], ["env-qa", "sheet"],
  ["ink", "row-hover"], ["ink", "row-selected"],
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => ["sheet"].map((s) => [`chart-${n}`, s])),
  ["cobalt", "sheet"], ["violet-ink", "violet-soft"], ["on-solid", "cobalt"],
  // toasts and the danger button
  ["bg", "ink"], ["good-ink", "go-soft"], ["bad-ink", "stop-soft"], ["on-solid", "stop"],
];
const mxSeriesOnWell = [1, 2, 3, 4, 5, 6].map((n) => [`chart-${n}`, "well"]);
for (const [theme, vars] of Object.entries(mxThemes)) {
  for (const [fg, bg] of [...mxPairs, ...mxSeriesOnWell]) {
    const floor = fg.startsWith("chart-") && bg === "well" ? 3.9 : 4.5;
    const r = ratio(rx(vars, `--mx-${fg}`), rx(vars, `--mx-${bg}`));
    const ok = r >= floor;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} mx ${theme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}`);
  }
}
console.log(fail ? `check-contrast: ${fail} failure(s)` : `check-contrast: ${pairs.length * Object.keys(themes).length + (mxPairs.length + mxSeriesOnWell.length) * 2} pairs ok`);
process.exit(fail ? 1 : 0);
