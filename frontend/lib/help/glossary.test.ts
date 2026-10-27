import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY, glossaryEntry, isGlossaryKey } from "./glossary";

const ROOT = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sourceFiles(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

/** Every `help="key"` (a Stat) and `term="key"` (a HelpHint) literal under a directory. */
function usedKeys(dir: string): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  for (const file of sourceFiles(dir)) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/\bhelp=\{?"([A-Za-z]+)"\}?/g)) found.push({ key: m[1], file });
    for (const m of src.matchAll(/<HelpHint\s+term=\{?"([A-Za-z]+)"\}?/g)) found.push({ key: m[1], file });
  }
  return found;
}

describe("glossary", () => {
  const entries = Object.entries(GLOSSARY);

  it("defines every term the spec lists", () => {
    const terms = entries.map(([, e]) => e.term.toLowerCase());
    for (const wanted of [
      "data quality score", "cap", "dimension", "basis", "scope", "applicability", "grain", "population exclusion",
      "field status", "unmaintained field", "root cause", "proven cost", "variant", "happy path", "conformance",
      "fitness", "golden record", "survivorship", "match rule", "contract", "wave", "dry run", "z-object",
      "ghost configuration", "drift",
    ]) {
      expect(terms, wanted).toContain(wanted);
    }
  });

  it.each(entries)("%s keeps to the length limits", (_key, e) => {
    expect(e.short.length).toBeLessThanOrEqual(120);
    expect(e.long.length).toBeLessThanOrEqual(400);
    expect(e.short.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s links only inside the app", (_key, e) => {
    if (e.href) expect(e.href.startsWith("/")).toBe(true);
  });

  it("states the cap values the scoring uses", () => {
    expect(GLOSSARY.cap.short).toMatch(/85/);
    expect(GLOSSARY.cap.short).toMatch(/70/);
  });

  it("looks entries up by key", () => {
    expect(isGlossaryKey("dqs")).toBe(true);
    expect(isGlossaryKey("nope")).toBe(false);
    expect(glossaryEntry("fitness").term).toBe("Fitness");
  });
});

describe("the four counts of what fails", () => {
  it("defines each once, with its own term", () => {
    const terms = [GLOSSARY.failingRules, GLOSSARY.ruleFailures, GLOSSARY.failingRecords, GLOSSARY.recordsToFix].map((e) => e.term);
    expect(terms).toEqual(["Failing rules", "Rule failures", "Failing records", "Records to fix"]);
    expect(GLOSSARY.ruleFailures.short).toMatch(/three times/);
    expect(GLOSSARY.failingRecords.short).toMatch(/once/);
  });

  // A label that once named one quantity with another's word. Each pattern is a label next to the field it counted.
  const MISLABELS: [RegExp, string][] = [
    [/header: "Failing records"[^\n]*(affected_records|m\.affected\b)/, "a sum over rules labelled failing records"],
    [/label="Open findings"/, "failing rules labelled open findings"],
    [/plural\([^)]*, "issue"\)} across/, "rule failures labelled issues"],
    [/plural\(b\.(open_now|fixed_7d), "failing record"\)/, "the burn-down's rule failures labelled failing records"],
    [/records resolved and/, "resolved rule failures labelled records"],
    // "Affected records" sat beside "Rule failures" on one figure; a figure takes one of the four labels.
    [/(label|header)[=:] ?\{?["'`][^"'`\n]*[Aa]ffected records/, "a figure labelled affected records"],
    [/\} affected records, \{/, "rule failures labelled affected records in a sentence"],
    // Counts of rules are failing rules, never "findings".
    [/(label|header)[=:] ?\{?["'`](Critical|High|Medium|Low|Critical and high) findings["'`]/, "failing rules labelled findings"],
    [/label="Findings (resolved|introduced)"/, "failing rules cleared or introduced labelled findings"],
    [/Critical findings cleared/, "critical failing rules cleared labelled findings"],
    [/needs the most work: \$\{[^}]*\} findings/, "an object's failing rules labelled findings"],
    // The work list's figure is records to fix; one rule's records are failing records. "Records failing" was both.
    [/"Records failing"/, "a figure labelled records failing"],
    // The cap in one unit: critical failing rules over tolerance and the objects they cap (lib/home-metrics.ts capSentence).
    [/critical finding\S* (is|are) capping/, "the cap counted in critical findings"],
    [/capped by critical rules/, "the cap counted in capped objects alone"],
    // The cap's count carries its noun: "4 critical failing rules", never a bare "4 critical".
    [/\$\{criticals\} critical`/, "the cap's critical failing rules without a noun"],
    // A ledger of rule failures is ranked by rule failures; one rule's records are its failing records.
    [/Ranked by records affected/, "a ranking over a rule failures column called records affected"],
    [/most records affected first/, "a rule ledger ranked by failing records called records affected"],
    // The run's list of failing rules is "Failing rules" (the ?tab=findings link stays).
    [/label: "Findings", content: <FindingsTab/, "the run's failing rules tab labelled findings"],
    // Figures next to each other say their unit: critical records to fix beside critical and high failing rules.
    [/\n\s+label="Critical"\n/, "a count labelled critical with no unit"],
    [/label="Critical and high" value=/, "critical and high failing rules with no unit in the label"],
    // One wording for records that carry a suggested value (Fix work's tile, the cleansing funnel's stage).
    [/"With a suggestion"/, "records with a suggested value called with a suggestion"],
    [/With a proposed value/, "records with a suggested value called with a proposed value"],
    // What changed describes a change; who owns an issue is said under the owners.
    [/changed: \{ sentence: [^\n]*Nobody owns/, "ownership stated as what changed"],
  ];
  it.each(MISLABELS)("no page labels %s (%s)", (pattern) => {
    const hits = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]
      .filter((f) => pattern.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  // Labels the API sends for a page to show verbatim (the cleansing funnel's stages) keep the same vocabulary.
  const API_LABELS = ["../api/services/insights_aggregate.py"];
  it.each(MISLABELS)("no API label %s (%s)", (pattern) => {
    expect(API_LABELS.filter((f) => pattern.test(readFileSync(path.join(ROOT, f), "utf8")))).toEqual([]);
  });

  it("names the cleansing funnel's stage of records with a suggested value as Fix work does", () => {
    const src = readFileSync(path.join(ROOT, "app/(app)/insights/_components/RunAnalyses.tsx"), "utf8");
    expect(src).toMatch(/proposed: "With a suggested value"/);
  });
});

describe("glossary coverage", () => {
  it("has an entry for every help= and HelpHint key used in app/ and design/", () => {
    const used = [...usedKeys("app"), ...usedKeys("design")];
    expect(used.length).toBeGreaterThan(0);
    const unknown = used.filter(({ key }) => !isGlossaryKey(key));
    expect(unknown).toEqual([]);
  });
});
