import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads design/v2/tokens.css the way the browser would for one theme: the declarations of the light root, then those of
 * the dark blocks over them, with every var() reference followed to its literal. Shared by the token, contrast and
 * accent tests so each measures the file, not a copy of it.
 */
export const TOKENS_CSS = readFileSync(join(__dirname, "..", "tokens.css"), "utf8");

/** Declarations of one block: the text between the braces that follow `selector`. */
export function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no block ${selector}`);
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

export const decls = (body: string): Record<string, string> =>
  Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--m2-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

export const LIGHT = decls(block(TOKENS_CSS, ".m2-root {"));
export const DARK_MEDIA = decls(block(block(TOKENS_CSS, "@media (prefers-color-scheme: dark)"), 'html:not([data-theme="light"]) .m2-root'));
export const DARK_ATTR = decls(block(TOKENS_CSS, 'html[data-theme="dark"] .m2-root'));

export type Theme = "light" | "dark";
export const themeVars = (theme: Theme): Record<string, string> => (theme === "light" ? LIGHT : { ...LIGHT, ...DARK_ATTR });

/** The literal a token comes to in a theme: "#RRGGBB" (or #RRGGBBAA), or the raw value when it is not a colour. */
export function resolve(theme: Theme, name: string, depth = 0): string {
  const vars = themeVars(theme);
  const v = vars[name];
  if (v === undefined) throw new Error(`${name} is not defined (${theme})`);
  const ref = /^var\((--m2-[\w-]+)\)$/.exec(v);
  if (ref && depth < 10) return resolve(theme, ref[1], depth + 1);
  return v;
}

const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminanceOf(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastOf(a: string, b: string): number {
  const [x, y] = [luminanceOf(a), luminanceOf(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** WCAG contrast of two tokens in a theme. */
export const tokenContrast = (theme: Theme, fg: string, bg: string): number => contrastOf(resolve(theme, fg), resolve(theme, bg));

/*
 * Colour-vision separation for the chart palette: OKLab distance (x100) between two hues, as a viewer with protanopia
 * or deuteranopia sees them (Machado, Oliveira and Fernandes 2009, severity 1.0), and with full colour vision.
 */
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;
const s2lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linRgb = (hex: string): number[] => [0, 2, 4].map((i) => s2lin(parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255));
function oklab([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function simulate(hex: string, kind: keyof typeof MACHADO): number[] {
  const v = linRgb(hex);
  return MACHADO[kind].map((row) => Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
}
export function deltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const p = oklab(kind ? simulate(a, kind) : linRgb(a));
  const q = oklab(kind ? simulate(b, kind) : linRgb(b));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
/** OKLCH lightness and chroma. */
export function lightnessChroma(hex: string): [number, number] {
  const [L, a, b] = oklab(linRgb(hex));
  return [L, Math.hypot(a, b)];
}
