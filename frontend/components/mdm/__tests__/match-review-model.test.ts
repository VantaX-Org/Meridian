import { describe, expect, it } from "vitest";
import type { AttributeExplanation } from "@/lib/api/merge-explain";
import { attributeVerdict, defaultPicks, overridesFromPicks, whyMatched, winnerPicks } from "../match-review-model";
import { changedFields } from "../merged-records";

const attr = (field: string, p: Partial<AttributeExplanation>): AttributeExplanation => ({
  field, comparator: "fuzzy", value_a: "", value_b: "", similarity: 0, weight: 1, contribution: 0, threshold: null, skipped: false, ...p,
});

describe("match review model", () => {
  it("reads an attribute's verdict from its threshold, else 85% similarity", () => {
    expect(attributeVerdict(attr("A", { threshold_met: true, similarity: 0.1 }))).toBe("matched");
    expect(attributeVerdict(attr("A", { threshold_met: false, similarity: 1 }))).toBe("differs");
    expect(attributeVerdict(attr("A", { similarity: 0.9 }))).toBe("matched");
    expect(attributeVerdict(attr("A", { skipped: true }))).toBe("skipped");
  });

  it("says why in one line, strongest field first", () => {
    expect(whyMatched({ attributes: [
      attr("CITY", { similarity: 1, contribution: 0.5 }), attr("NAME", { similarity: 0.95, contribution: 2 }),
      attr("TAX", { similarity: 0, contribution: 0 }),
    ], total: 0.8, weight_total: 3, band: "steward_review", auto_action: "queued", fired: "", rules_met: [], rules_failed: [] }))
      .toBe("Matched on NAME and CITY, differs on TAX");
    expect(whyMatched(null)).toBe("No field comparison was recorded");
  });

  it("defaults each field to the survivor, or the other record where the survivor is blank", () => {
    expect(defaultPicks({ N: "x", T: "" }, { N: "y", T: "1", C: "z" }, "a")).toEqual({ C: "b", N: "a", T: "b" });
  });

  it("prefers the preview's survivorship winners and turns only differing picks into overrides", () => {
    const base = winnerPicks({ N: { winner_key: "K2" } }, "K1", "K2", { N: "a", T: "a" });
    expect(base).toEqual({ N: "b", T: "a" });
    expect(overridesFromPicks({ N: "b", T: "b" }, base, { N: "x", T: "" }, { N: "y", T: "1" })).toEqual({ T: "1" });
  });

  it("lists only the golden values a split would change", () => {
    expect(changedFields({ A: "1", B: "2" }, { A: "1", B: "", C: "3" })).toEqual([
      { field: "B", before: "2", after: "" }, { field: "C", before: "", after: "3" },
    ]);
  });
});
