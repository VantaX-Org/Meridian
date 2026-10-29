import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..");
const tokens = readFileSync(join(DIR, "tokens.css"), "utf8");
const styles = readFileSync(join(DIR, "v2.css"), "utf8");

/** Declarations of one block: the text between the braces that follow `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--m2-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const light = decls(block(tokens, ".m2-root {"));
const darkMedia = decls(block(block(tokens, "@media (prefers-color-scheme: dark)"), "html:not([data-theme=\"light\"]) .m2-root"));
const darkAttr = decls(block(tokens, "html[data-theme=\"dark\"] .m2-root"));

const COLOUR = Object.keys(light).filter((k) => /^#[0-9a-f]{6,8}$/i.test(light[k]));

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("v2 tokens", () => {
  it("defines a light palette and the same colour tokens for dark, both by system preference and by data-theme", () => {
    expect(COLOUR.length).toBeGreaterThanOrEqual(28);
    for (const k of COLOUR) {
      expect(darkMedia[k], `${k} in the dark media block`).toBeDefined();
      expect(darkAttr[k], `${k} in the data-theme block`).toBeDefined();
      expect(darkMedia[k], k).toBe(darkAttr[k]);
    }
    expect(light["--m2-bg"]).toBe("#FFFFFF");
    expect(light["--m2-sheet"]).toBe("#FFFFFF");
  });

  it("uses the prototype's palette: the data hue, the status hues and true neutral darks", () => {
    expect(light["--m2-data"]).toBe("#1B3F8F");
    expect(light["--m2-crit"]).toBe("#A3221A");
    expect(light["--m2-pass"]).toBe("#1D6B3F");
    expect(darkAttr["--m2-bg"]).toBe("#0E1113");
    expect(darkAttr["--m2-data"]).toBe("#8FB0F5");
  });

  it("has the type scale 12, 13, 14, 16, 20 and 24, the Plex faces and tabular figures", () => {
    const sizes = Object.entries(light).filter(([k]) => k.startsWith("--m2-fs-")).map(([, v]) => parseInt(v, 10));
    expect(sizes).toEqual([12, 13, 14, 16, 20, 24]);
    expect(light["--m2-font"]).toContain("--font-plex-sans");
    expect(light["--m2-mono"]).toContain("--font-plex-mono");
    expect(styles).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("spaces on a 4 pixel grid, rounds at 4 and 6, and moves in 150 and 200 milliseconds", () => {
    for (const [k, v] of Object.entries(light).filter(([k]) => /^--m2-s\d+$/.test(k))) expect(parseInt(v, 10) % 4, k).toBe(0);
    expect(light["--m2-r1"]).toBe("4px");
    expect(light["--m2-r2"]).toBe("6px");
    expect(light["--m2-t-fast"]).toBe("150ms");
    expect(light["--m2-t-med"]).toBe("200ms");
  });

  it("keeps motion in tokens.css only and respects reduced motion", () => {
    expect(styles).not.toMatch(/\b(transition|animation)\s*:/);
    expect(styles).not.toMatch(/@keyframes/);
    expect(tokens).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("v2.css reads only tokens that tokens.css defines, and holds no raw colour, gradient or blur", () => {
    const used = new Set([...styles.matchAll(/var\((--m2-[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) expect(light[name], `${name} is used in v2.css but not defined`).toBeDefined();
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styles).not.toMatch(/gradient\(|backdrop-filter|blur\(/);
    expect(styles).not.toMatch(/text-transform\s*:\s*uppercase/);
  });

  it("is scoped to .m2-root so nothing reaches the current interface", () => {
    const selectors = [...tokens.matchAll(/^([^\s@}/*][^{]*)\{/gm)].map((m) => m[1].trim());
    for (const s of selectors) expect(s, s).toMatch(/m2-root/);
  });
});

describe("v2 contrast", () => {
  const pairs: [string, string, number][] = [
    ["--m2-fg", "--m2-bg", 4.5],
    ["--m2-ink-2", "--m2-bg", 4.5],
    ["--m2-meta", "--m2-bg", 4.5],
    ["--m2-meta", "--m2-sheet", 4.5],
    ["--m2-data", "--m2-bg", 4.5],
    ["--m2-on-data", "--m2-data", 4.5],
    ["--m2-crit-ink", "--m2-crit-bg", 4.5],
    ["--m2-high-ink", "--m2-high-bg", 4.5],
    ["--m2-pass-ink", "--m2-pass-bg", 4.5],
    ["--m2-crit", "--m2-bg", 4.5],
    ["--m2-high", "--m2-bg", 4.5],
    ["--m2-pass", "--m2-bg", 4.5],
    ["--m2-fg", "--m2-active", 4.5],
    ["--m2-meta", "--m2-hover", 4.5],
    ["--m2-data", "--m2-active", 4.5],
    ["--m2-on-inverse", "--m2-inverse", 4.5],
    ["--m2-ink-3", "--m2-bg", 3],
    ["--m2-seg", "--m2-track", 3],
  ];
  for (const [name, palette] of [["light", light], ["dark", darkAttr]] as const) {
    it(`${name}: text, data and status colours meet 4.5:1 (3:1 for marks) on their grounds`, () => {
      const p = { ...light, ...palette };
      for (const [fg, bg, min] of pairs) expect(contrast(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    });
  }
});
