// frontend/lib/__tests__/format-copy.test.ts
// Copy helpers behind the Insights fixes: agreed plurals, money with its code, system and module display names,
// run-axis ticks that never show a user-supplied label, and the delta and trend sentences.
import { describe, expect, it } from "vitest";
import {
  deltaSentence, formatModuleName, formatMoney, MODULE_LABELS, plural, runAxisLabels, shortList, systemTypeLabel, trendSentence,
} from "../format";

describe("plural", () => {
  it("agrees the noun with the count and formats thousands", () => {
    expect(plural(1, "record")).toBe("1 record");
    expect(plural(2310, "record")).toBe("2,310 records");
    expect(plural(0, "wave")).toBe("0 waves");
  });
  it("takes an irregular or phrasal plural", () => {
    expect(plural(1, "blocking field fails", "blocking fields fail")).toBe("1 blocking field fails");
    expect(plural(3, "stage is", "stages are")).toBe("3 stages are");
  });
});

describe("shortList", () => {
  it("names the first two and counts the rest", () => {
    expect(shortList(["GL024", "GL003", "GL001", "GL002", "GL005"])).toBe("GL024, GL003 and 3 more");
    expect(shortList(["GL024", "GL003"])).toBe("GL024, GL003");
    expect(shortList([])).toBe("");
  });
});

describe("formatMoney", () => {
  it("writes the currency code, never a symbol, with no decimals", () => {
    const out = formatMoney(5672930, "ZAR");
    expect(out).toContain("ZAR");
    expect(out).toMatch(/5[,.  ]672[,.  ]930/);
    expect(out).not.toContain("R5");
    expect(out).not.toMatch(/\.\d\d$/);
  });
  it("falls back to plain digits without a currency", () => {
    expect(formatMoney(1200)).toMatch(/^1[,.  ]200$/);
  });
  it("does not throw on an unknown code", () => {
    expect(formatMoney(5, "NOTACODE")).toContain("5");
  });
});

describe("display names", () => {
  it("formatModuleName uses the module display map for acronyms", () => {
    expect(formatModuleName("fi_gl")).toBe("FI general ledger");
    expect(formatModuleName("pii")).toBe("PII");
    expect(formatModuleName("mm_purchasing")).toBe("MM purchasing");
    expect(MODULE_LABELS.fi_gl).toBe("FI general ledger");
  });
  it("formatModuleName title-cases anything not in the map", () => {
    expect(formatModuleName("business_partner")).toBe("Business Partner");
    expect(formatModuleName("material_master")).toBe("Material Master");
  });
  it("systemTypeLabel maps system types to their product names", () => {
    expect(systemTypeLabel("ecc")).toBe("ECC");
    expect(systemTypeLabel("s4hana_cloud")).toBe("S/4HANA Cloud");
    expect(systemTypeLabel("successfactors")).toBe("SuccessFactors");
    expect(systemTypeLabel(null)).toBe("—");
    expect(systemTypeLabel("some_other")).toBe("Some other");
  });
});

describe("runAxisLabels", () => {
  it("ticks are dates, and date with time only where two runs share a day", () => {
    const labels = runAxisLabels([
      { id: "a", run_at: "2026-10-02T09:00:00Z" },
      { id: "b", run_at: "2026-10-16T05:00:00Z" },
      { id: "c", run_at: "2026-10-16T17:30:00Z" },
    ]);
    expect(labels.get("a")).toBe("2 Oct 2026");
    expect(labels.get("b")).toBe("16 Oct 2026, 05:00");
    expect(labels.get("c")).toBe("16 Oct 2026, 17:30");
  });
  it("never carries the run's upload label", () => {
    const labels = runAxisLabels([{ id: "business_partner_100k", run_at: "2026-10-02T09:00:00Z" }]);
    expect([...labels.values()]).toEqual(["2 Oct 2026"]);
  });
  it("gives a dash for a missing date", () => {
    expect(runAxisLabels([{ id: "x", run_at: null }]).get("x")).toBe("—");
  });
});

describe("deltaSentence", () => {
  it("writes up, down, unchanged or first run", () => {
    expect(deltaSentence(2.14)).toBe("Up 2.1 since the last run");
    expect(deltaSentence(-0.8)).toBe("Down 0.8 since the last run");
    expect(deltaSentence(0)).toBe("Unchanged since the last run");
    expect(deltaSentence(0.04)).toBe("Unchanged since the last run");
    expect(deltaSentence(null)).toBe("First scored run");
    expect(deltaSentence(undefined)).toBe("First scored run");
  });
});

describe("trendSentence", () => {
  it("says held at when the first and last values are equal", () => {
    expect(trendSentence(70, 70, 2)).toBe("Composite score held at 70 over 2 runs.");
    expect(trendSentence(70.04, 70, 3)).toBe("Composite score held at 70 over 3 runs.");
  });
  it("says rose or fell otherwise, with the run count agreed", () => {
    expect(trendSentence(60, 70, 2)).toBe("Composite score rose from 60 to 70 over 2 runs.");
    expect(trendSentence(82.5, 70, 4, "Completeness")).toBe("Completeness fell from 82.5 to 70 over 4 runs.");
  });
});
