import { describe, expect, it } from "vitest";
import {
  ANY_SYSTEM, DASH, VERDICT_LABEL, WEIGHT_PERCENT, breachNames, byMeasured, capSentence, dimensionShort, f1, findSystem, int,
  labelWidth, labelsOverlap, moduleFromSlug, moduleSlug, pct1, readingText, rulerGeometry, scoreY, segmentShares, spreadLabels,
  systemForModule, systemSlug,
} from "./score";

describe("number formatting", () => {
  it("shows a dash for a missing value", () => {
    for (const fn of [f1, int, pct1]) {
      expect(fn(null)).toBe(DASH);
      expect(fn(undefined)).toBe(DASH);
      expect(fn(Number.NaN)).toBe(DASH);
    }
    expect(f1(72.46)).toBe("72.5");
    expect(int(12345.6)).toBe("12,346");
    expect(pct1(0.9743)).toBe("97.4%");
  });

  it("labels verdicts and weights", () => {
    expect(VERDICT_LABEL.go).toBe("Go");
    expect(VERDICT_LABEL["no-go"]).toBe("No-go");
    expect(VERDICT_LABEL["at-risk"]).toBe("At risk");
    expect(WEIGHT_PERCENT).toEqual([25, 25, 20, 10, 10, 10]);
  });
});

describe("labels", () => {
  it("measures Latin and CJK text", () => {
    expect(labelWidth("ab")).toBe(14);
    expect(labelWidth("品質")).toBe(24);
  });

  it("has a short name for every dimension", () => {
    for (const k of ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const) expect(dimensionShort(k)).toMatch(/\S/);
  });

  it("spreads overlapping labels apart, in order", () => {
    const out = spreadLabels([{ y: 10, height: 14 }, { y: 0, height: 14 }, { y: 40, height: 14 }]);
    expect(out.map((l) => l.y)).toEqual([0, 16, 40]);
  });

  it("detects overlap", () => {
    const box = { kind: "scale" as const, text: "", title: "", x: 0, y: 0, width: 10, height: 10 };
    expect(labelsOverlap(box, { ...box, x: 5 })).toBe(true);
    expect(labelsOverlap(box, { ...box, x: 20 })).toBe(false);
  });
});

describe("rulerGeometry", () => {
  it("clamps scoreY", () => {
    expect(scoreY(150, 0, 100)).toBe(0);
    expect(scoreY(-5, 0, 100)).toBe(100);
  });

  it("draws the small bar without axis or labels", () => {
    const g = rulerGeometry(48, [100, 50, null, 0, 120, -3], null);
    expect(g.tickY).toBeNull();
    expect(g.axis).toEqual([]);
    expect(g.labels).toEqual([]);
    expect(g.segments[2].fillHeight).toBe(0);
    expect(segmentShares(g).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  it.each([{}, { compact: true }, { compact: true, available: 200 }])("lays out the large ruler with no overlapping labels (%o)", (opts) => {
    const g = rulerGeometry(240, [90, 80, 70, null, 50, 40], 72, opts);
    expect(g.tickY).not.toBeNull();
    expect(g.axis.length).toBeGreaterThan(0);
    expect(g.caps.map((c) => c.value)).toEqual([85, 70]);
    const left = g.labels.filter((l) => l.kind === "band" || l.kind === "scale");
    for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) expect(labelsOverlap(left[i], left[j])).toBe(false);
    expect(g.labels.some((l) => l.text === DASH)).toBe(true);
  });
});

describe("reading words", () => {
  it("names breaches", () => {
    expect(breachNames([])).toBe("");
    expect(breachNames(["MM003", "MM035"])).toBe("MM003 and MM035");
    expect(breachNames(["a", "b", "c"])).toMatch(/3/);
  });

  it("reads a score in full", () => {
    const base = { label: "Material", measured: 80, score: 70, capped: true, capLevel: 70, breaches: ["MM003"], dims: [90, null, 70, 60, 50, 40], records: 1000, rules: 12, coverage: 0.5, lowConfidence: true };
    const s = readingText(base);
    expect(s).toContain("Material scores 70.0");
    expect(s).toContain("MM003");
    expect(readingText({ ...base, capped: false, lowConfidence: false })).not.toContain("MM003");
  });

  it("says what caps the score", () => {
    expect(capSentence(false, null, [])).toMatch(/nothing holds/);
    expect(capSentence(false, null, ["a"])).toMatch(/already below/);
    expect(capSentence(true, 85, ["a"])).toContain("a");
    expect(capSentence(true, 70, ["a", "b"])).toContain("b");
    expect(capSentence(true, 70, ["a", "b", "c"])).toContain("3");
  });
});

describe("slugs and lookups", () => {
  const systems = [{ id: "S1", name: "ECC Production" }, { id: "S2", name: "S/4 QA" }];

  it("round-trips module and system slugs", () => {
    expect(moduleSlug("material_master")).toBe("material-master");
    expect(moduleFromSlug("material-master")).toBe("material_master");
    expect(systemSlug("  ECC Production! ")).toBe("ecc-production");
    expect(ANY_SYSTEM).toBe("_");
  });

  it("finds a system by slug, id or name", () => {
    expect(findSystem(systems, "ecc-production")?.id).toBe("S1");
    expect(findSystem(systems, "s2")?.id).toBe("S2");
    expect(findSystem(systems, "nope")).toBeUndefined();
  });

  it("picks the system holding most records of a module", () => {
    const cells = [
      { system_id: "S1", module: "mm", records_checked: 5 },
      { system_id: "S2", module: "mm", records_checked: 50 },
      { system_id: "SX", module: "cm", records_checked: null },
    ];
    expect(systemForModule(systems, cells, "mm")?.id).toBe("S2");
    expect(systemForModule(systems, cells, "cm")).toBeUndefined();
  });

  it("orders lowest measured first, unscored last, ties by name", () => {
    const cells = [
      { module: "c", raw_score: null, score: null },
      { module: "b", raw_score: 60, score: 70 },
      { module: "a", raw_score: null, score: 60 },
    ];
    expect(byMeasured(cells).map((c) => c.module)).toEqual(["a", "b", "c"]);
  });
});
