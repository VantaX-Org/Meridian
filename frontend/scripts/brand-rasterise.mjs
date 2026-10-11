#!/usr/bin/env node
/**
 * Rasterises the Meridian brand SVGs (frontend/public/brand, plus app/icon.svg)
 * into the PNGs Next.js and the backend templates consume. Idempotent.
 * icon-32/192/512.png and the templates PNGs are rasterised from mark-light.svg
 * (gauge arc + meridian line). app/icon.svg is the hand-authored favicon; it is
 * only validated here (must contain the two paths), never rewritten.
 *
 * Usage: node scripts/brand-rasterise.mjs  (or: npm run brand:rasterise)
 */
import sharp from "sharp";
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "public", "brand");
const TEMPLATES = join(ROOT, "..", "templates", "assets", "brand");

const paths = (file) => {
  const d = [...readFileSync(file, "utf8").matchAll(/<path[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]);
  if (d.length < 2) throw new Error(`${file}: expected arc + meridian <path d>, found ${d.length}`);
  return d;
};
// Fail loudly if either source drifts from the two-path construction.
paths(join(BRAND, "mark-light.svg"));
paths(join(ROOT, "app", "icon.svg"));

const png = async (src, out, w, h = w) => {
  mkdirSync(dirname(out), { recursive: true });
  await sharp(src, { density: 384 }).resize(w, h).png().toFile(out);
};
const svg = (name) => join(BRAND, name);

// Transparent-background mark PNGs: PWA fallbacks.
for (const s of [32, 192, 512]) await png(svg("mark-light.svg"), join(BRAND, `icon-${s}.png`), s);

// Maskable: full-bleed gradient tile, mark inside the 80% safe zone.
const apple = readFileSync(svg("apple-icon.svg"), "utf8");
const maskable = await sharp(Buffer.from(apple), { density: 384 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#2B4BE0" } })
  .composite([{ input: maskable, gravity: "centre" }])
  .png()
  .toFile(join(BRAND, "icon-512-maskable.png"));

await png(svg("apple-icon.svg"), join(ROOT, "app", "apple-icon.png"), 180);
await png(svg("og-image.svg"), join(ROOT, "app", "opengraph-image.png"), 1200, 630);

// Backend copies (XLSX cover, PDF cover).
mkdirSync(TEMPLATES, { recursive: true });
copyFileSync(svg("mark-light.svg"), join(TEMPLATES, "mark-light.svg"));
await png(svg("mark-light.svg"), join(TEMPLATES, "mark-light.png"), 64);
await png(svg("mark-dark.svg"), join(TEMPLATES, "mark-dark.png"), 64);

console.log("Brand assets rasterised.");
