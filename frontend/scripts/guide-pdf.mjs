/**
 * Prints the Meridian guide (docs/guide, in the order of docs/guide/index.json) to one PDF with a contents page:
 * docs/guide/meridian-guide.pdf. It renders the chapters' markdown to a plain HTML page and prints it with headless
 * Chromium through Playwright, the same browser the help recordings use.
 *
 *   npm run guide:pdf                            (PW_CHROMIUM=/path/to/chrome to use a browser you already have)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE = path.join(root, "docs", "guide");
const OUT = path.join(GUIDE, "meridian-guide.pdf");
const FONTS = path.join(path.dirname(GUIDE), "..", "app", "_fonts");

/** The product's own faces (IBM Plex, app/_fonts), embedded so the PDF reads like the screens on any machine. */
function fontFaces() {
  const face = (family, file, weight) =>
    `@font-face { font-family: "${family}"; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(path.join(FONTS, file)).toString("base64")}) format("woff2"); }`;
  return [
    face("IBM Plex Sans", "IBMPlexSans-latin-400.woff2", 400),
    face("IBM Plex Sans", "IBMPlexSans-latin-600.woff2", 600),
    face("IBM Plex Mono", "IBMPlexMono-latin-400.woff2", 400),
  ].join("\n  ");
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bold, code and links of one line of markdown; a link keeps its text and drops its target. */
export function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

/** The subset of markdown the guide uses: headings, paragraphs, bullet and numbered lists. */
export function markdownToHtml(md, id) {
  const out = [];
  const blocks = md.replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const h = /^(#{1,3}) (.*)$/.exec(lines[0]);
    if (h && lines.length === 1) {
      const level = h[1].length;
      out.push(level === 1 ? `<h1 id="${id}">${inline(h[2])}</h1>` : `<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\s*\d+\. /.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\. /, ""))}</li>`).join("")}</ol>`);
      continue;
    }
    out.push(`<p>${inline(lines.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function guideHtml(date = new Date()) {
  const index = JSON.parse(readFileSync(path.join(GUIDE, "index.json"), "utf8"));
  const toc = [];
  const body = [];
  for (const section of index.sections) {
    toc.push(`<li class="sec">${esc(section.label)}<ol>`);
    body.push(`<section class="part"><p class="partname">${esc(section.label)}</p></section>`);
    for (const c of section.chapters) {
      const id = `ch-${c.slug}`;
      toc.push(`<li><a href="#${id}">${esc(c.title)}</a></li>`);
      body.push(`<article class="chapter">${markdownToHtml(readFileSync(path.join(GUIDE, `${c.slug}.md`), "utf8"), id)}</article>`);
    }
    toc.push("</ol></li>");
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(index.title)}</title><style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  ${fontFaces()}
  body { font: 10.5pt/1.5 "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; color: #1A2233; font-variant-numeric: tabular-nums; }
  h1 { font-size: 20pt; margin: 0 0 8pt; break-after: avoid; }
  h2 { font-size: 13pt; margin: 16pt 0 4pt; break-after: avoid; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
  p, li { margin: 0 0 6pt; orphans: 3; widows: 3; }
  ul, ol { padding-left: 16pt; margin: 0 0 8pt; }
  code { font-family: "IBM Plex Mono", "DejaVu Sans Mono", monospace; font-size: 9pt; }
  .chapter { break-before: page; }
  .cover { height: 240mm; display: flex; flex-direction: column; justify-content: flex-end; }
  .cover h1 { font-size: 30pt; } .cover p { color: #4A5568; }
  .toc { break-before: page; } .toc ol { list-style: none; padding-left: 0; } .toc .sec { font-weight: 600; margin-top: 10pt; }
  .toc .sec ol li { font-weight: 400; margin: 2pt 0 2pt 12pt; } .toc a { color: inherit; text-decoration: none; }
  .part { break-before: page; height: 200mm; display: flex; align-items: center; } .partname { font-size: 22pt; font-weight: 600; }
  </style></head><body>
  <section class="cover"><h1>${esc(index.title)}</h1><p>Every screen, what its numbers mean and where they come from, what each role can do, the keyboard, and what to do when something is wrong.</p><p>Edition of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)}.</p></section>
  <nav class="toc"><h1>Contents</h1><ol>${toc.join("")}</ol></nav>
  ${body.join("\n")}
  </body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = guideHtml();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="font: 8pt Arial, sans-serif; color: #4A5568; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>Meridian guide</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await browser.close();
  writeFileSync(OUT, pdf);
  console.log(`docs/guide/meridian-guide.pdf written, ${pdf.length} bytes`);
}
