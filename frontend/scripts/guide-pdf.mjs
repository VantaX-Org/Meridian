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

/** The product's own faces (Geist, app/_fonts), embedded so the PDF reads like the screens on any machine. */
export function fontFaces() {
  const face = (family, file, weight) =>
    `@font-face { font-family: "${family}"; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(path.join(FONTS, file)).toString("base64")}) format("woff2"); }`;
  return [
    face("Geist", "Geist-latin-wght.woff2", "100 900"),
    face("Geist Mono", "GeistMono-latin-wght.woff2", "100 900"),
  ].join("\n  ");
}

export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Brand colours as data (public/brand/brand.json), so the PDFs match the screens and lint:tokens stays clean. */
export const BRAND = JSON.parse(readFileSync(path.join(root, "public", "brand", "brand.json"), "utf8"));

/** The two-tone mark (public/brand/README.md): the ink arc and the accent meridian line. */
export const mark = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke="${BRAND.ink}" stroke-width="3" stroke-linecap="round"/><path d="M16 3V29" stroke="${BRAND.accent}" stroke-width="3" stroke-linecap="round"/></svg>`;

/** Branded cover, chapter and contents styling shared by every Meridian PDF. */
export const brandCss = () => `
  h1 { color: ${BRAND.ink}; } h2 { color: ${BRAND.accent}; }
  .chapter > h1:first-child { padding-bottom: 6pt; border-bottom: 2pt solid ${BRAND.accent}; }
  .cover { height: 240mm; padding: 4mm 0 0; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
  .cover .lockup { display: flex; align-items: center; gap: 10pt; font-size: 20pt; font-weight: 600; letter-spacing: -0.01em; color: ${BRAND.ink}; }
  .cover .kicker { color: ${BRAND.accent}; font-weight: 600; font-size: 10pt; margin: 0 0 6pt; }
  .cover h1 { font-size: 32pt; line-height: 1.1; margin: 0 0 12pt; } .cover p { color: ${BRAND.ink2}; max-width: 140mm; }
  .cover .rule { height: 3pt; width: 40mm; background: ${BRAND.accent}; border-radius: 2pt; margin: 0 0 14pt; }
  .cover .foot { font-size: 9pt; color: ${BRAND.ink2}; border-top: 1px solid #D9DDE3; padding-top: 8pt; display: flex; justify-content: space-between; }
  .toc h1 { border-bottom: 2pt solid ${BRAND.accent}; padding-bottom: 6pt; }`;

/** The cover page: lockup at the top, title block, edition at the foot. */
export const cover = ({ kicker, title, lede, edition }) => `<section class="cover">
  <div class="lockup">${mark(34)}<span>Meridian</span></div>
  <div><p class="kicker">${esc(kicker)}</p><div class="rule"></div><h1>${esc(title)}</h1><p>${esc(lede)}</p></div>
  <div class="foot"><span>SAP data quality, measured</span><span>Edition of ${esc(edition)}</span></div></section>`;

/** Page header and footer for page.pdf: the mark and name on top, the document name and page count below. */
export const pageChrome = (label) => ({
  headerTemplate: `<div style="font: 600 8pt Arial, sans-serif; color: ${BRAND.ink}; width: 100%; padding: 0 16mm; display: flex; align-items: center; gap: 5px;">${mark(11)}<span>Meridian</span></div>`,
  footerTemplate: `<div style="font: 8pt Arial, sans-serif; color: ${BRAND.ink2}; width: 100%; margin: 0 16mm; padding-top: 4px; border-top: 1px solid ${BRAND.accent}; display: flex; justify-content: space-between;"><span>${esc(label)}</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});

/** Bold, code and links of one line of markdown; a link keeps its text and drops its target. */
export function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

/**
 * The subset of markdown the guide uses: headings, paragraphs, bullet and numbered lists; and for the administrator
 * training guide also fenced code, pipe tables and images (`image(src, alt)` turns an image path into HTML).
 */
export function markdownToHtml(md, id, image = null) {
  const out = [];
  // Fenced code first, so blank lines inside a fence stay inside it.
  const fences = [];
  const text = md.replace(/\r/g, "").replace(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm, (_, code) => {
    fences.push(code.replace(/\n$/, ""));
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const fence = /^\u0000FENCE(\d+)\u0000$/.exec(lines[0].trim());
    if (fence && lines.length === 1) {
      out.push(`<pre><code>${esc(fences[Number(fence[1])])}</code></pre>`);
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(lines[0].trim());
    if (img && lines.length === 1 && image) {
      out.push(image(img[2], img[1]));
      continue;
    }
    if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1])) {
      const cells = (l) => l.trim().slice(1, -1).split("|").map((c) => inline(c.trim()));
      const head = cells(lines[0]).map((c) => `<th>${c}</th>`).join("");
      const rows = lines.slice(2).map((l) => `<tr>${cells(l).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,4}) (.*)$/.exec(lines[0]);
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
    if (image && /^\s*\d+\. /.test(lines[0])) {
      // A numbered list whose items wrap onto indented lines, possibly with a nested bullet list.
      const items = [];
      for (const l of lines) {
        if (/^\d+\. /.test(l)) items.push({ text: l.replace(/^\d+\. /, ""), sub: [] });
        else if (/^\s+[-*] /.test(l) && items.length) items[items.length - 1].sub.push(l.trim().replace(/^[-*] /, ""));
        else if (items.length) {
          const it = items[items.length - 1];
          if (it.sub.length) it.sub[it.sub.length - 1] += ` ${l.trim()}`;
          else it.text += ` ${l.trim()}`;
        }
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ol>`);
      continue;
    }
    if (image && /^\s*[-*] /.test(lines[0])) {
      const items = [];
      for (const l of lines) {
        if (/^[-*] /.test(l)) items.push(l.replace(/^[-*] /, ""));
        else if (items.length) items[items.length - 1] += ` ${l.trim()}`;
      }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
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
  body { font: 10.5pt/1.5 "Geist", "Helvetica Neue", Arial, sans-serif; color: #111112; font-variant-numeric: tabular-nums; }
  h1 { font-size: 20pt; margin: 0 0 8pt; break-after: avoid; }
  h2 { font-size: 13pt; margin: 16pt 0 4pt; break-after: avoid; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
  p, li { margin: 0 0 6pt; orphans: 3; widows: 3; }
  ul, ol { padding-left: 16pt; margin: 0 0 8pt; }
  code { font-family: "Geist Mono", "DejaVu Sans Mono", monospace; font-size: 9pt; }
  .chapter { break-before: page; }
  .toc { break-before: page; } .toc ol { list-style: none; padding-left: 0; } .toc .sec { font-weight: 600; margin-top: 10pt; }
  .toc .sec ol li { font-weight: 400; margin: 2pt 0 2pt 12pt; } .toc a { color: inherit; text-decoration: none; }
  ${brandCss()}
  .part { break-before: page; height: 200mm; display: flex; align-items: center; } .partname { font-size: 22pt; font-weight: 600; }
  </style></head><body>
  ${cover({ kicker: "User guide", title: index.title, lede: "Every screen, what its numbers mean and where they come from, what each role can do, the keyboard, and what to do when something is wrong.", edition: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date) })}
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
    ...pageChrome("Meridian guide"),
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await browser.close();
  writeFileSync(OUT, pdf);
  console.log(`docs/guide/meridian-guide.pdf written, ${pdf.length} bytes`);
}
