import { readFileSync } from "node:fs";
import { ROW_H, personaDensity, resolveDensity } from "@/lib/v2/density";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DARK_ATTR, DARK_MEDIA, LIGHT, TOKENS_CSS as tokens, block, decls, contrastOf, deltaE, lightnessChroma, resolve, tokenContrast, type Theme } from "./tokens-css";

const styles = readFileSync(join(__dirname, "..", "v2.css"), "utf8");
const THEMES: readonly Theme[] = ["light", "dark"];

/** The tokens a theme sets: every one the dark blocks name. */
const THEMED = Object.keys(DARK_ATTR);
const isColour = (v: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v);

describe("v2 tokens", () => {
  it("builds the neutrals and the blues from two ramps, each step a literal, light to dark", () => {
    const steps = (prefix: string) => Object.entries(LIGHT).filter(([k]) => k.startsWith(prefix));
    const neutral = steps("--m2-n-");
    const blue = steps("--m2-b-");
    expect(neutral.length).toBeGreaterThanOrEqual(15);
    expect(blue.length).toBeGreaterThanOrEqual(10);
    for (const ramp of [neutral, blue]) {
      for (const [k, v] of ramp) expect(isColour(v), k).toBe(true);
      const L = ramp.map(([, v]) => lightnessChroma(v)[0]);
      for (let i = 1; i < L.length; i++) expect(L[i], `${ramp[i][0]} is darker than ${ramp[i - 1][0]}`).toBeLessThan(L[i - 1]);
    }
    // The brand blue is a step of its ramp, not a colour of its own.
    expect(LIGHT["--m2-b-700"]).toBe("#1B3F8F");
    expect(LIGHT["--m2-data"]).toBe("var(--m2-b-700)");
  });

  it("sets the same tokens for dark by system preference and by data-theme, and only tokens light defines", () => {
    expect(THEMED.length).toBeGreaterThanOrEqual(40);
    expect(DARK_MEDIA).toEqual(DARK_ATTR);
    for (const k of THEMED) expect(LIGHT[k], `${k} is set in dark but not in light`).toBeDefined();
    // The ramps are the same in both themes: only the semantic tokens change step.
    for (const k of THEMED) expect(k, k).not.toMatch(/^--m2-[nb]-\d+$/);
  });

  it("resolves every semantic colour to a literal in both themes", () => {
    const semantic = Object.keys(LIGHT).filter((k) => /^var\(--m2-[nb]-\d+\)$/.test(LIGHT[k]) || isColour(LIGHT[k]));
    expect(semantic.length).toBeGreaterThanOrEqual(60);
    for (const theme of THEMES) for (const k of semantic) expect(isColour(resolve(theme, k)), `${k} in ${theme}`).toBe(true);
  });

  it("uses the brand palette: the blue data hue, the status hues and the slate grounds", () => {
    expect(resolve("light", "--m2-data")).toBe("#1B3F8F");
    expect(resolve("light", "--m2-crit")).toBe("#A3221A");
    expect(resolve("light", "--m2-pass")).toBe("#1D6B3F");
    expect(resolve("light", "--m2-sheet")).toBe("#FFFFFF");
    expect(resolve("light", "--m2-bg")).toBe("#F7F9FB");
    expect(resolve("dark", "--m2-bg")).toBe("#0E1215");
    expect(resolve("dark", "--m2-data")).toBe("#8EB1F5");
    // Fail and critical share the stop red; high severity reads in the warn hue.
    for (const theme of THEMES) {
      expect(resolve(theme, "--m2-fail")).toBe(resolve(theme, "--m2-crit"));
      expect(resolve(theme, "--m2-high")).toBe(resolve(theme, "--m2-warn"));
    }
  });

  it("has the type scale 12, 13, 14, 16, 20 and 24, the Plex faces and tabular figures", () => {
    const sizes = Object.entries(LIGHT).filter(([k]) => /^--m2-fs-\d+$/.test(k)).map(([, v]) => parseInt(v, 10));
    expect(sizes).toEqual([12, 13, 14, 16, 20, 24]);
    expect(LIGHT["--m2-font"]).toContain("--font-plex-sans");
    expect(LIGHT["--m2-mono"]).toContain("--font-plex-mono");
    expect(styles).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("spaces on a 4 pixel grid, rounds at 4 and 6, and moves in 150 and 200 milliseconds", () => {
    for (const [k, v] of Object.entries(LIGHT).filter(([k]) => /^--m2-s\d+$/.test(k))) expect(parseInt(v, 10) % 4, k).toBe(0);
    expect(LIGHT["--m2-r1"]).toBe("4px");
    expect(LIGHT["--m2-r2"]).toBe("6px");
    expect(LIGHT["--m2-t-fast"]).toBe("150ms");
    expect(LIGHT["--m2-t-med"]).toBe("200ms");
  });

  it("keeps motion in tokens.css only and respects reduced motion", () => {
    expect(styles).not.toMatch(/\b(transition|animation)\s*:/);
    expect(styles).not.toMatch(/@keyframes/);
    expect(tokens).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("v2.css reads only tokens that tokens.css defines, and holds no raw colour, gradient or blur", () => {
    const used = new Set([...styles.matchAll(/var\((--m2-[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) expect(LIGHT[name], `${name} is used in v2.css but not defined`).toBeDefined();
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styles).not.toMatch(/gradient\(|backdrop-filter|blur\(/);
    expect(styles).not.toMatch(/text-transform\s*:\s*uppercase/);
  });

  it("is scoped to .m2-root so nothing reaches the current interface", () => {
    const selectors = [...tokens.matchAll(/^([^\s@}/*][^{]*)\{/gm)].map((m) => m[1].trim());
    for (const s of selectors) expect(s, s).toMatch(/m2-root/);
  });
});

/** Text, data and status pairs at 4.5:1 (WCAG 1.4.3); marks, rings and chart fills at 3:1 (WCAG 1.4.11). */
const TEXT: [string, string][] = [
  ["--m2-fg", "--m2-bg"], ["--m2-fg", "--m2-sheet"], ["--m2-fg", "--m2-hover"], ["--m2-fg", "--m2-active"], ["--m2-fg", "--m2-data-bg"],
  ["--m2-ink-2", "--m2-bg"], ["--m2-ink-2", "--m2-sheet"], ["--m2-ink-2", "--m2-hover"], ["--m2-ink-2", "--m2-active"],
  ["--m2-meta", "--m2-bg"], ["--m2-meta", "--m2-sheet"], ["--m2-meta", "--m2-hover"], ["--m2-meta", "--m2-active"],
  ["--m2-data", "--m2-bg"], ["--m2-data", "--m2-sheet"], ["--m2-data", "--m2-hover"], ["--m2-data", "--m2-active"], ["--m2-data", "--m2-data-bg"],
  ["--m2-on-data", "--m2-data"], ["--m2-on-inverse", "--m2-inverse"], ["--m2-chart-text", "--m2-sheet"],
  ...(["pass", "warn", "crit", "fail", "info"] as const).flatMap((s): [string, string][] => [
    [`--m2-${s}`, "--m2-bg"], [`--m2-${s}`, "--m2-sheet"], [`--m2-${s}-ink`, `--m2-${s}-bg`], ["--m2-fg", `--m2-${s}-bg`],
  ]),
];
const MARKS: [string, string][] = [
  ["--m2-ink-3", "--m2-bg"], ["--m2-ink-3", "--m2-sheet"], ["--m2-seg", "--m2-track"], ["--m2-focus", "--m2-sheet"], ["--m2-focus", "--m2-bg"],
  ["--m2-chart-line", "--m2-sheet"], ["--m2-on-inverse-crit", "--m2-inverse"], ["--m2-chart-quiet", "--m2-sheet"],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i): [string, string] => [`--m2-chart-${i}`, "--m2-sheet"]),
  ...["crit", "high", "med"].map((s): [string, string] => [`--m2-sev-${s}`, "--m2-sheet"]),
];

describe("v2 contrast", () => {
  for (const theme of THEMES) {
    it(`${theme}: text, data and status colours meet 4.5:1 on every ground they are drawn on`, () => {
      for (const [fg, bg] of TEXT) expect(tokenContrast(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: marks, the focus ring and chart fills meet 3:1 on the sheet`, () => {
      for (const [fg, bg] of MARKS) expect(tokenContrast(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("v2 chart palette", () => {
  const cat = (theme: Theme) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => resolve(theme, `--m2-chart-${i}`));
  const band: Record<Theme, [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };
  for (const theme of THEMES) {
    it(`${theme}: eight categorical hues in the lightness band, saturated enough to read as hues`, () => {
      for (const hex of cat(theme)) {
        const [L, C] = lightnessChroma(hex);
        expect(L, hex).toBeGreaterThanOrEqual(band[theme][0]);
        expect(L, hex).toBeLessThanOrEqual(band[theme][1]);
        expect(C, hex).toBeGreaterThanOrEqual(0.1);
      }
    });
    it(`${theme}: neighbours stay apart for protanopia, deuteranopia and full colour vision`, () => {
      const p = cat(theme);
      for (let i = 1; i < p.length; i++) {
        const cvd = Math.min(deltaE(p[i - 1], p[i], "protan"), deltaE(p[i - 1], p[i], "deutan"));
        expect(cvd, `${p[i - 1]} beside ${p[i]}`).toBeGreaterThanOrEqual(8);
        expect(deltaE(p[i - 1], p[i]), `${p[i - 1]} beside ${p[i]}`).toBeGreaterThanOrEqual(15);
      }
      // The first three hold on every pair: a scatter or a small-multiple legend may use them together.
      for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
        expect(Math.min(deltaE(p[a], p[b], "protan"), deltaE(p[a], p[b], "deutan")), `${p[a]} and ${p[b]}`).toBeGreaterThanOrEqual(8);
        expect(deltaE(p[a], p[b]), `${p[a]} and ${p[b]}`).toBeGreaterThanOrEqual(15);
      }
    });
    it(`${theme}: the severity scale recedes from critical to low, its faint end at the 2:1 floor of an ordinal end`, () => {
      const sev = ["crit", "high", "med", "low"].map((k) => resolve(theme, `--m2-sev-${k}`));
      const sheet = resolve(theme, "--m2-sheet");
      const c = sev.map((h) => contrastOf(h, sheet));
      expect(c[2], "medium").toBeGreaterThan(c[3]);
      expect(c[3], "low").toBeGreaterThanOrEqual(2);
    });
    it(`${theme}: the sequential ramp is one hue, steps apart in lightness, its faint end visible on the sheet`, () => {
      const seq = [1, 2, 3, 4, 5].map((i) => resolve(theme, `--m2-seq-${i}`));
      const L = seq.map((h) => lightnessChroma(h)[0]);
      // Light reads from pale to deep; dark from deep to bright. Either way each step is a visible step.
      for (let i = 1; i < L.length; i++) expect(Math.abs(L[i] - L[i - 1]), `${seq[i - 1]} to ${seq[i]}`).toBeGreaterThanOrEqual(0.06);
      expect(contrastOf(seq[0], resolve(theme, "--m2-sheet"))).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("v2 density", () => {
  const compact = decls(block(tokens, '.m2-root [data-density="compact"] {'));
  const comfortable = decls(block(tokens, '.m2-root [data-density="comfortable"] {'));
  it("drives the row heights, padding and text step from tokens, and the grid measures with the same heights", () => {
    expect(parseInt(LIGHT["--m2-row-h"], 10)).toBe(ROW_H.comfortable);
    expect(parseInt(comfortable["--m2-row-h"], 10)).toBe(ROW_H.comfortable);
    expect(parseInt(compact["--m2-row-h"], 10)).toBe(ROW_H.compact);
    for (const k of ["--m2-row-h", "--m2-list-row-h", "--m2-orow-h", "--m2-fact-h", "--m2-cell-px", "--m2-cell-py", "--m2-row-fs", "--m2-row-lh"]) {
      expect(compact[k], k).toBeDefined();
      expect(comfortable[k], k).toBe(LIGHT[k]);
    }
    expect(compact["--m2-row-fs"]).toBe("var(--m2-fs-13)");
    expect(comfortable["--m2-row-fs"]).toBe("var(--m2-fs-14)");
    expect(styles).toMatch(/\.m2-gcell \{ padding: 0 var\(--m2-cell-px\)/);
  });
  it("starts stewards and Basis compact, leads and owners comfortable, and a choice wins over the role", () => {
    expect(personaDensity("steward")).toBe("compact");
    expect(personaDensity("basis")).toBe("compact");
    expect(personaDensity("lead")).toBe("comfortable");
    expect(personaDensity("owner")).toBe("comfortable");
    expect(resolveDensity(undefined, "steward")).toBe("compact");
    expect(resolveDensity("default", "basis")).toBe("compact");
    expect(resolveDensity("comfortable", "steward")).toBe("comfortable");
    expect(resolveDensity("compact", "lead")).toBe("compact");
  });
});
