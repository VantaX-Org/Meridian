import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../tokens.css"), "utf8");

function block(start: string): Record<string, string> {
  const i = css.indexOf(start);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--nx-[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
const light = block('.nx-root,\n.nx-root[data-nx-theme="light"]');
const dark = block('.nx-root[data-nx-theme="dark"]');

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT: [string, string][] = [
  ["--nx-ink", "--nx-bg"], ["--nx-ink", "--nx-surface"], ["--nx-ink-2", "--nx-surface"], ["--nx-ink-3", "--nx-surface"],
  ["--nx-accent-ink", "--nx-accent"], ["--nx-accent", "--nx-surface"], ["--nx-ink", "--nx-accent-soft"],
  ["--nx-good-ink", "--nx-good-soft"], ["--nx-warn-ink", "--nx-warn-soft"], ["--nx-bad-ink", "--nx-bad-soft"],
];
const EDGE: [string, string][] = [["--nx-control-edge", "--nx-surface"], ["--nx-focus", "--nx-surface"], ["--nx-focus", "--nx-bg"]];

describe.each([["light", light], ["dark", dark]] as const)("tokens %s", (_n, tk) => {
  it("defines every token the pairs need", () => {
    for (const [a, b] of [...TEXT, ...EDGE]) { expect(tk[a], a).toBeTruthy(); expect(tk[b], b).toBeTruthy(); }
  });
  it.each(TEXT)("text %s on %s is at least 4.5:1", (a, b) => expect(ratio(tk[a], tk[b])).toBeGreaterThanOrEqual(4.5));
  it.each(EDGE)("edge %s on %s is at least 3:1", (a, b) => expect(ratio(tk[a], tk[b])).toBeGreaterThanOrEqual(3));
});

it("uses the spec accent in each theme", () => {
  expect(light["--nx-accent"].toLowerCase()).toBe("#1f5eff");
  expect(dark["--nx-accent"].toLowerCase()).toBe("#6b96ff");
});

// Apple/Meta-spirit additions (design-apple-meta.md 2.1): glass, elevation, selection, thumb, handle.
function all(selector: string, from = 0): Record<string, string> {
  const i = css.indexOf(selector, from);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--nx-[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const lightAll = all('.nx-root,\n.nx-root[data-nx-theme="light"]');
const darkAttrAll = all('html[data-theme="dark"] .nx-root:not([data-nx-theme="light"])');
const darkExplicitAll = all('.nx-root[data-nx-theme="dark"]');
const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
const darkMediaAll = all(".nx-root", css.indexOf("{", mediaStart) + 1);

const NEW_COLOUR = [
  "--nx-glass-bg", "--nx-glass-bg-strong", "--nx-glass-edge", "--nx-glass-line", "--nx-glass-sat", "--nx-elev-1", "--nx-elev-3",
  "--nx-surface-3", "--nx-thumb", "--nx-thumb-shadow", "--nx-sel", "--nx-sel-ink", "--nx-handle", "--nx-accent-pressed", "--nx-ink-on-glass",
];

function rgba(v: string): [number, number, number, number] {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(v);
  if (!m) throw new Error(`not rgb(): ${v}`);
  return [+m[1], +m[2], +m[3], +m[4] / 100];
}
function over(top: string, under: string): string {
  const [r, g, b, a] = rgba(top);
  const u = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
  const mix = [r, g, b].map((c, i) => Math.round(c * a + u[i] * (1 - a)));
  return `#${mix.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

describe.each([
  ["light", lightAll, light],
  ["dark attribute", darkAttrAll, dark],
  ["dark explicit", darkExplicitAll, dark],
  ["dark media", darkMediaAll, dark],
] as const)("new tokens %s", (name, set, hex) => {
  it("defines every new colour token", () => {
    for (const k of NEW_COLOUR) expect(set[k], `${k} in ${name}`).toBeTruthy();
  });
  const base = name === "light" ? light : dark;
  it("ink on glass is at least 4.5:1 over the bg and over the accent wash", () => {
    for (const under of ["--nx-bg", "--nx-accent-soft"]) {
      const ground = over(set["--nx-glass-bg-strong"], base[under]);
      expect(ratio(set["--nx-ink-on-glass"], ground), `${under}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("selected ink on the selection wash is at least 4.5:1", () => {
    expect(ratio(set["--nx-sel-ink"], set["--nx-sel"])).toBeGreaterThanOrEqual(4.5);
  });
  it("glass keeps at least 64 percent opacity so text never sits on raw backdrop", () => {
    expect(rgba(set["--nx-glass-bg"])[3]).toBeGreaterThanOrEqual(0.64);
    expect(rgba(set["--nx-glass-bg-strong"])[3]).toBeGreaterThanOrEqual(rgba(set["--nx-glass-bg"])[3]);
  });
  void hex;
});

it("lays out shape, type and layout additions", () => {
  expect(lightAll["--nx-r-control"] ?? css).toBeTruthy();
  for (const t of ["--nx-r-control: 8px", "--nx-r-card: 12px", "--nx-r-popover: 12px", "--nx-r-sheet: 16px", "--nx-sidebar-w: 15rem", "--nx-tabbar-h: 3.5rem", "--nx-fs-large: 1.75rem", "--nx-h-control: 2.75rem"]) {
    expect(css, t).toContain(t);
  }
});

it("falls back for glass without backdrop-filter, in print and in forced colours", () => {
  expect(css).toContain("@supports not ((backdrop-filter");
  expect(css).toContain("@media print");
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("Canvas");
});

it("maps the tenant accent onto next", () => {
  expect(css).toContain("[data-tenant-accent]");
  expect(css).toContain("--nx-accent: var(--m2-data");
});
