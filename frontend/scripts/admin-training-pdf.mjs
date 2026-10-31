/**
 * Prints the administrator training guide (docs/admin-training/meridian-administrator-training.md) to
 * docs/admin-training/meridian-administrator-training.pdf with the main guide's renderer and typography
 * (scripts/guide-pdf.mjs: the same markdown subset, IBM Plex embedded, headless Chromium through Playwright). The
 * screenshots under docs/admin-training/img are embedded in the file.
 *
 *   npm run training:pdf                         (PW_CHROMIUM=/path/to/chrome to use a browser you already have)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { esc, fontFaces, markdownToHtml } from "./guide-pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(root, "..", "docs", "admin-training");
const SRC = path.join(DIR, "meridian-administrator-training.md");
const OUT = path.join(DIR, "meridian-administrator-training.pdf");
/** The edition this source describes; change it with the text. */
const EDITION = "31 October 2026";

/** A screenshot as an embedded figure with its caption. */
function figure(src, alt) {
  const data = readFileSync(path.join(DIR, src)).toString("base64");
  return `<figure><img src="data:image/png;base64,${data}" alt="${esc(alt)}"><figcaption>${esc(alt)}</figcaption></figure>`;
}

export function trainingHtml() {
  const md = readFileSync(SRC, "utf8");
  const title = /^# (.*)$/m.exec(md)[1];
  // One chapter per module: split at the module headings, the text before the first is the introduction.
  const parts = md.replace(/^# .*\n/, "").split(/^(?=## )/m);
  const intro = parts.shift() ?? "";
  const toc = [];
  const body = [`<article class="chapter"><h1 id="intro">About this course</h1>${markdownToHtml(intro, "intro", figure)}</article>`];
  parts.forEach((part, i) => {
    const heading = /^## (.*)$/m.exec(part)[1];
    const id = `m-${i + 1}`;
    toc.push(`<li><a href="#${id}">${esc(heading)}</a></li>`);
    body.push(`<article class="chapter">${markdownToHtml(part.replace(/^## /, "# "), id, figure)}</article>`);
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  ${fontFaces()}
  body { font: 10.5pt/1.5 "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; color: #1A2233; font-variant-numeric: tabular-nums; }
  h1 { font-size: 20pt; margin: 0 0 8pt; break-after: avoid; }
  h2 { font-size: 13pt; margin: 16pt 0 4pt; break-after: avoid; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
  p, li { margin: 0 0 6pt; orphans: 3; widows: 3; }
  ul, ol { padding-left: 16pt; margin: 0 0 8pt; } li ul { margin: 4pt 0 0; }
  code { font-family: "IBM Plex Mono", "DejaVu Sans Mono", monospace; font-size: 9pt; }
  pre { background: #F4F5F7; border: 1px solid #D9DDE3; border-radius: 4px; padding: 6pt 8pt; white-space: pre-wrap; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 9pt; }
  th, td { border-bottom: 1px solid #D9DDE3; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { font-weight: 600; } tr { break-inside: avoid; } th:first-child, td:first-child { width: 30%; }
  figure { margin: 8pt 0 12pt; break-inside: avoid; } figure img { width: 100%; border: 1px solid #D9DDE3; }
  figcaption { font-size: 9pt; color: #4A5568; margin-top: 3pt; }
  .chapter { break-before: page; }
  .cover { height: 240mm; display: flex; flex-direction: column; justify-content: flex-end; }
  .cover h1 { font-size: 30pt; } .cover p { color: #4A5568; }
  .toc { break-before: page; } .toc ol { padding-left: 16pt; } .toc li { margin: 3pt 0; } .toc a { color: inherit; text-decoration: none; }
  </style></head><body>
  <section class="cover"><h1>${esc(title)}</h1><p>For the customer's Meridian administrator and their SAP Basis colleague: install and first start, licence, users and access, connecting SAP, extraction, scoring and money, fixing data and write-back, notifications, operations and troubleshooting.</p><p>Edition of ${EDITION}.</p></section>
  <nav class="toc"><h1>Contents</h1><ol>${toc.join("")}</ol></nav>
  ${body.join("\n")}
  </body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.setContent(trainingHtml(), { waitUntil: "load" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="font: 8pt Arial, sans-serif; color: #4A5568; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>Meridian administrator training</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await browser.close();
  writeFileSync(OUT, pdf);
  console.log(`docs/admin-training/meridian-administrator-training.pdf written, ${pdf.length} bytes`);
}
