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

describe("glossary coverage", () => {
  it("has an entry for every help= and HelpHint key used in app/ and design/", () => {
    const used = [...usedKeys("app"), ...usedKeys("design")];
    expect(used.length).toBeGreaterThan(0);
    const unknown = used.filter(({ key }) => !isGlossaryKey(key));
    expect(unknown).toEqual([]);
  });
});
