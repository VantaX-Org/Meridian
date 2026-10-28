// The count vocabulary has one home: lib/counts.ts. This test keeps the words from drifting in two ways:
//  1. A lint-style scan of app/ and components/ for a count's label written out as a string where a page names a
//     tile, column or badge (`label="Records to fix"`, `header: "Rule failures"`). Take the words from COUNT_DEFS.
//  2. The user guide glossary lists every label and hint, from the same source.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNT_DEFS, COUNT_KEYS, COUNTS_GLOSSARY_HEADING, countsGlossarySection } from "../counts";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LABELS = COUNT_KEYS.map((k) => COUNT_DEFS[k].label);

/**
 * Precise on purpose: only an exact string that is the whole value of a `label` or `header` property or prop. Prose,
 * titles, aria text and sentences that merely contain the words are never matched. A line that carries a
 * `counts-ok` comment is skipped (for a word that means something else on that line).
 */
const SITE = new RegExp(`\\b(?:label|header)(?:=\\{?|:\\s*)["'\`](${LABELS.map(escape).join("|")})["'\`]`, "g");

function sitesIn(file: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.includes("counts-ok")) continue;
    for (const m of line.matchAll(SITE)) found[m[1]!] = (found[m[1]!] ?? 0) + 1;
  }
  return found;
}

/**
 * Sites that still write a count label by hand, per file and label. This only ever shrinks: a file may hold at most
 * this many (a new site fails the test), and the work package that owns the page switches it to COUNT_DEFS and
 * deletes its line. "Score" and "Verdict" here include columns that mean something else (a match score, a wave
 * verdict); an owner either switches them or marks the line `counts-ok`.
 */
const DEBT: Record<string, Record<string, number>> = {
  "app/(app)/fix/page.tsx": { "Records to fix": 1 },
  "app/(app)/home/process/page.tsx": { "Verdict": 1, "Rule failures": 1 },
  "app/(app)/import/page.tsx": { "Score": 1 },
  "app/(app)/insights/exec/page.tsx": { "Verdict": 1, "Score": 1 },
  "app/(app)/insights/forecast/page.tsx": { "Verdict": 1 },
  "app/(app)/insights/lineage/page.tsx": { "Failing rules": 1 },
  "app/(app)/insights/owners/page.tsx": { "Score": 1 },
  "app/(app)/insights/readiness/page.tsx": { "Verdict": 1 },
  "app/(app)/insights/trends/page.tsx": { "Score": 1, "Rule failures": 1 },
  "app/(app)/migration/[waveId]/page.tsx": { "Verdict": 1, "Score": 1 },
  "app/(app)/migration/[waveId]/s4-tab.tsx": { "Failing rules": 2 },
  "app/(app)/migration/page.tsx": { "Verdict": 2 },
  "app/(app)/objects/[object]/_fix.tsx": { "With a suggested value": 1 },
  "app/(app)/objects/[object]/_monitor.tsx": { "Newly failing rules": 1, "Recovered rules": 1 },
  "app/(app)/objects/[object]/_workbench.tsx": { "Failing rules": 2, "Critical and high failing rules": 1, "Rule failures": 1 },
  "app/(app)/objects/[object]/page.tsx": { "Score": 1, "Records to fix": 1 },
  "app/(app)/objects/[object]/records/[key]/page.tsx": { "Failing rules": 4 },
  "app/(app)/objects/page.tsx": { "Rule failures": 2, "Score": 1, "Verdict": 1, "Failing rules": 1, "Critical and high failing rules": 1 },
  "app/(app)/runs/[versionId]/page.tsx": { "Score": 2, "Failing rules": 2, "Rule failures": 3, "Critical and high failing rules": 1 },
  "app/(app)/runs/page.tsx": { "Score": 1 },
  "app/(app)/systems/[systemId]/page.tsx": { "Score": 3, "Failing rules": 1 },
  "app/(app)/systems/[systemId]/trend-panel.tsx": { "Score": 1 },
  "app/(app)/systems/page.tsx": { "Score": 1 },
  "components/mdm/merged-records.tsx": { "Score": 1 },
  "components/work/fix-work.tsx": { "Critical records": 1, "With a suggested value": 1, "Records to fix": 2 },
};

describe("count labels come from COUNT_DEFS", () => {
  const files = ["app", "components"].flatMap((d) => walk(path.join(ROOT, d)));

  it("defines every key once with a label, a hint and a unit", () => {
    expect(new Set(LABELS).size).toBe(LABELS.length);
    for (const k of COUNT_KEYS) {
      const d = COUNT_DEFS[k];
      expect(d.label, k).toMatch(/^[A-Z][^.]*$/);
      expect(d.hint.endsWith("."), k).toBe(true);
      expect(d.unit, k).toBeTruthy();
    }
    expect(COUNT_DEFS.rule_failures.hint).toContain("a record failing two rules counts twice");
    expect(COUNT_KEYS).toHaveLength(17);
  });

  it("finds the sites it is meant to find", () => {
    expect(SITE.test('<Stat label="Records to fix" />')).toBe(true);
    SITE.lastIndex = 0;
    expect('{ header: "Rule failures" }'.match(SITE)).toHaveLength(1);
    expect('<Stat label="Records to fix by owner" />'.match(SITE)).toBeNull();
    expect('<Stat label={COUNT_DEFS.records_to_fix.label} />'.match(SITE)).toBeNull();
    expect("// the rule failures column".match(SITE)).toBeNull();
  });

  it("writes no count label by hand beyond the shrinking debt list", () => {
    const over: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      const allowed = DEBT[rel] ?? {};
      for (const [label, n] of Object.entries(sitesIn(f))) {
        if (n > (allowed[label] ?? 0)) over.push(`${rel}: "${label}" written ${n} time(s), allowed ${allowed[label] ?? 0}; use COUNT_DEFS`);
      }
    }
    expect(over).toEqual([]);
  });

  it("lists in DEBT only files that exist", () => {
    const rels = new Set(files.map((f) => path.relative(ROOT, f).split(path.sep).join("/")));
    expect(Object.keys(DEBT).filter((f) => !rels.has(f))).toEqual([]);
  });

  it("has no hand-written count label left in the files this vocabulary was applied to", () => {
    for (const f of ["app/(app)/home/_persona-home.tsx"]) expect(sitesIn(path.join(ROOT, f)), f).toEqual({});
  });
});

describe("glossary", () => {
  const FILE = path.join(ROOT, "docs/user-guide/glossary.md");

  it("lists every count label and hint, as generated from COUNT_DEFS", () => {
    let text = readFileSync(FILE, "utf8");
    const section = countsGlossarySection();
    if (process.env.UPDATE_GLOSSARY && !text.includes(section)) {
      // Replace the section in place (from its heading to the next level-2 heading), or add it before Related.
      const start = text.indexOf(`## ${COUNTS_GLOSSARY_HEADING}`);
      if (start >= 0) {
        const next = text.indexOf("\n## ", start + 3);
        text = text.slice(0, start) + section + "\n" + (next >= 0 ? text.slice(next) : "");
      } else {
        text = text.replace("\n## Related", `\n${section}\n\n## Related`);
      }
      writeFileSync(FILE, text);
    }
    text = readFileSync(FILE, "utf8");
    expect(text).toContain(section);
    for (const k of COUNT_KEYS) {
      expect(text, k).toContain(`### ${COUNT_DEFS[k].label}`);
      expect(text, k).toContain(COUNT_DEFS[k].hint);
    }
  });

  it("is listed in the guide index", () => {
    const index = JSON.parse(readFileSync(path.join(ROOT, "docs/user-guide/index.json"), "utf8")) as { sections: { pages: { slug: string }[] }[] };
    expect(index.sections.flatMap((s) => s.pages.map((p) => p.slug))).toContain("glossary");
  });
});
