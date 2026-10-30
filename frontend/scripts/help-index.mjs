/**
 * Builds the index the help panel searches: every chapter of the guide (docs/guide), with its recording, the
 * recording's caption lines (docs/guide/tours.json) and, for a role's walkthrough, its five steps. Also the dated
 * "What's new" lines (docs/guide/whats-new.json), newest first, and each recording's length from
 * docs/help-videos/manifest.json.
 * `node scripts/help-index.mjs` writes lib/v2/help-data.json; lib/v2/help.test.ts fails when the file is out of date.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** "6c" sorts after "6b" after "6" after "5". */
export function stepRank(step) {
  const m = /^(\d+)([a-z]?)$/.exec(String(step));
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : -1;
}

/** Newest first: by date, then by step. */
export function orderWhatsNew(entries) {
  return [...entries].sort((a, b) => (a.date === b.date ? stepRank(b.step) - stepRank(a.step) : a.date < b.date ? 1 : -1));
}

export function buildHelpIndex() {
  const v2 = JSON.parse(read("docs", "guide", "index.json"));
  const tours = JSON.parse(read("docs", "guide", "tours.json")).tours;
  const manifestPath = path.join(root, "docs", "help-videos", "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).videos : {};
  const chapters = [];
  for (const section of v2.sections) {
    for (const c of section.chapters) {
      const md = read("docs", "guide", `${c.slug}.md`);
      const tour = tours.find((t) => t.video === c.video);
      chapters.push({
        id: `v2:${c.slug}`,
        kind: "v2",
        interface: "v2",
        group: section.label,
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        audiences: [],
        video: c.video,
        seconds: manifest[c.video]?.seconds ?? null,
        captions: tour ? tour.steps.map((s) => s.caption) : [],
        persona: c.persona ?? null,
        walkthrough: c.walkthrough ?? null,
        sections: sectionsOf(md),
      });
    }
  }
  const whatsNew = orderWhatsNew(JSON.parse(read("docs", "guide", "whats-new.json")));
  return { title: v2.title, v2Title: v2.title, whatsNew, chapters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(root, "lib", "v2", "help-data.json"), `${JSON.stringify(buildHelpIndex())}\n`);
  console.log("lib/v2/help-data.json written");
}
