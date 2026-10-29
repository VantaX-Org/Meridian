/**
 * Builds the help index the v2 help panel searches: every help-centre chapter (docs/help-centre) and every user-guide
 * page (docs/user-guide) as sections of plain text, with the training recording of the chapters that have one.
 * `node scripts/help-index.mjs` writes lib/v2/help-data.json; lib/v2/help.test.ts fails when the file is out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");

/** Splits a markdown chapter at its `## ` headings. The text before the first heading is the lead section. */
export function sectionsOf(md) {
  const body = md.replace(/^# .*\n/, "").replace(/\r/g, "");
  const parts = body.split(/^## /m);
  const out = [];
  const lead = parts.shift()?.trim();
  if (lead) out.push({ heading: "", text: lead });
  for (const part of parts) {
    const nl = part.indexOf("\n");
    out.push({ heading: part.slice(0, nl < 0 ? undefined : nl).trim(), text: (nl < 0 ? "" : part.slice(nl + 1)).trim() });
  }
  return out;
}

const firstParagraph = (md) => (md.replace(/^# .*\n/, "").trim().split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").slice(0, 200);

export function buildHelpIndex() {
  const journeys = JSON.parse(read("docs", "help-centre", "index.json"));
  const guide = JSON.parse(read("docs", "user-guide", "index.json"));
  const chapters = [];
  for (const section of journeys.sections) {
    for (const c of section.chapters) {
      const md = read("docs", "help-centre", `${c.slug}.md`);
      chapters.push({ id: `journey:${c.slug}`, kind: "journey", group: section.label, slug: c.slug, title: c.title, summary: c.summary, audiences: c.audiences, video: c.video, sections: sectionsOf(md) });
    }
  }
  for (const section of guide.sections) {
    for (const p of section.pages) {
      const md = read("docs", "user-guide", `${p.slug}.md`);
      chapters.push({ id: `guide:${p.slug}`, kind: "guide", group: section.title, slug: p.slug, title: p.title, summary: firstParagraph(md), audiences: [], video: null, sections: sectionsOf(md) });
    }
  }
  return { title: journeys.title, guideTitle: guide.title, chapters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(root, "lib", "v2", "help-data.json"), `${JSON.stringify(buildHelpIndex())}\n`);
  console.log("lib/v2/help-data.json written");
}
