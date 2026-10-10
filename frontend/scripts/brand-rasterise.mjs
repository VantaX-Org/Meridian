#!/usr/bin/env node
/**
 * Rasterises the Meridian mark/wordmark SVGs (frontend/public/brand) into
 * the PNG icon set and the app-icon files Next.js serves by convention.
 * Re-run after the source SVGs change; every output is overwritten, so the
 * script is idempotent. See frontend/public/brand/README.md for the mark.
 *
 * Usage: node scripts/brand-rasterise.mjs  (or: npm run brand:rasterise)
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "public", "brand");
const brand = JSON.parse(readFileSync(join(BRAND, "brand.json"), "utf8"));

const markLightSvg = readFileSync(join(BRAND, "mark-light.svg"), "utf8");

// The stroke path is shared by every colourway/size variant below.
const PATH_D = markLightSvg.match(/<path d="([^"]+)"/)[1];

function strokePath({ stroke = "#FFFFFF", strokeWidth = 3.25 } = {}) {
  return `<path d="${PATH_D}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The tile mark composed at an arbitrary box size, with the letterform scaled from its native 32px viewBox. */
function composedMark({ box, rx = 0, pad = 0 }) {
  const inner = box - pad * 2;
  const scale = inner / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  <rect width="${box}" height="${box}" rx="${rx}" fill="${brand.accent}"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})">${strokePath()}</g>
</svg>`;
}

async function writePng(svg, outPath, size) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
}

async function main() {
  // Plain PNG fallbacks/PWA icons: the tile mark at its own corner radius, scaled up.
  await writePng(markLightSvg, join(BRAND, "icon-32.png"), 32);
  await writePng(markLightSvg, join(BRAND, "icon-192.png"), 192);
  await writePng(markLightSvg, join(BRAND, "icon-512.png"), 512);

  // Maskable PWA icon: tile at full bleed (no rx — the OS applies its own mask),
  // letterform kept inside the 80% safe zone.
  const maskable = composedMark({ box: 512, rx: 0, pad: 512 * 0.1 });
  await writePng(maskable, join(BRAND, "icon-512-maskable.png"), 512);

  // iOS home screen icon: full-bleed tile (no rx), 20px internal padding at 180px.
  const appleIcon = composedMark({ box: 180, rx: 0, pad: 20 });
  await writePng(appleIcon, join(ROOT, "app", "apple-icon.png"), 180);

  // OpenGraph link preview: canvas + wordmark at 3x + tagline.
  const wordmarkW = 164 * 3;
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${brand.canvas}"/>
  <g transform="translate(${(1200 - wordmarkW) / 2} 210) scale(3)">
    <rect width="32" height="32" rx="6" fill="${brand.accent}"/>
    ${strokePath()}
    <text x="44" y="22" font-family="Public Sans, system-ui, sans-serif" font-size="20" font-weight="600" fill="#101418" letter-spacing="-0.2">Meridian</text>
  </g>
  <text x="600" y="420" text-anchor="middle" font-family="Public Sans, system-ui, sans-serif" font-size="26" font-weight="500" fill="#3C4852">SAP master-data quality, scored and routed to the people who fix it</text>
</svg>`;
  mkdirSync(join(ROOT, "app"), { recursive: true });
  await sharp(Buffer.from(ogSvg)).resize(1200, 630).png().toFile(join(ROOT, "app", "opengraph-image.png"));

  // The favicon served at /icon.svg: the light mark plus a dark-scheme swap,
  // so Chrome/Firefox show the right colourway in a dark browser tab.
  const iconSvg = markLightSvg.replace(
    "</svg>",
    `  <style>@media (prefers-color-scheme: dark){ rect{fill:${brand.accentDark}} path{stroke:${brand.canvasDark}} }</style>\n</svg>`,
  );
  mkdirSync(join(ROOT, "app"), { recursive: true });
  writeFileSync(join(ROOT, "app", "icon.svg"), iconSvg);

  // Copies for the backend (XLSX cover image, PDF cover include) — same mark,
  // vendored next to the Jinja templates so neither build needs to reach
  // across into frontend/public.
  const templatesBrand = join(ROOT, "..", "templates", "assets", "brand");
  mkdirSync(templatesBrand, { recursive: true });
  writeFileSync(join(templatesBrand, "mark-light.svg"), markLightSvg);
  await writePng(markLightSvg, join(templatesBrand, "mark-light.png"), 64);

  console.log("Brand assets rasterised.");
}

main();
