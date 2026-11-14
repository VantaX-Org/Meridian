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
const EDGE: [string, string][] = [["--nx-data", "--nx-surface"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((i): [string, string] => [`--nx-chart-${i}`, "--nx-surface"]), ["--nx-control-edge", "--nx-surface"], ["--nx-focus", "--nx-surface"], ["--nx-focus", "--nx-bg"]];

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
