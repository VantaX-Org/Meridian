import { describe, expect, it } from "vitest";
import { buildNarrative, verdictSentence } from "../home-narrative";
import type { ObjectSummary } from "../api/v1/objects";

const objects: ObjectSummary[] = [
  { module: "material_master", label: "Material Master", composite_score: 60, readiness: "fail", failing_checks: 12, affected_records: 500 },
  { module: "fi_gl", label: "FI General Ledger", composite_score: 95, readiness: "pass", failing_checks: 0, affected_records: 0 },
];

describe("buildNarrative", () => {
  it("produces exactly three sentences for a lead", () => {
    const text = buildNarrative({ role: "lead", objects });
    const sentences = text.trim().split(". ").filter(Boolean);
    expect(sentences).toHaveLength(3);
  });

  it("names the worst-readiness object first for a lead", () => {
    const text = buildNarrative({ role: "lead", objects });
    expect(text).toContain("Material Master");
  });

  it("is deterministic for the same input", () => {
    expect(buildNarrative({ role: "lead", objects })).toBe(buildNarrative({ role: "lead", objects }));
  });

  it("produces exactly three sentences for a steward and a basis admin too", () => {
    expect(buildNarrative({ role: "steward", objects }).trim().split(". ").filter(Boolean)).toHaveLength(3);
    expect(buildNarrative({ role: "basis", objects }).trim().split(". ").filter(Boolean)).toHaveLength(3);
  });

  it("names the real failing object, not an unanalysed null-score object", () => {
    const withUnanalysed: ObjectSummary[] = [
      { module: "unanalysed", label: "Unanalysed Object", composite_score: null, readiness: null, failing_checks: 0, affected_records: 0 },
      { module: "material_master", label: "Material Master", composite_score: 60, readiness: "fail", failing_checks: 12, affected_records: 500 },
    ];
    const text = buildNarrative({ role: "lead", objects: withUnanalysed });
    expect(text).toContain("Material Master");
  });
});

describe("verdictSentence", () => {
  const one: ObjectSummary = { module: "controlling", label: "Controlling", composite_score: 70, readiness: "fail", failing_checks: 6, affected_records: 10 };
  it("agrees noun and verb with the counts", () => {
    expect(verdictSentence([one])).toBe("1 of 1 object is not ready for go-live.");
    expect(verdictSentence(objects)).toBe("1 of 2 objects is not ready for go-live.");
    expect(verdictSentence([one, { ...one, module: "fi_gl" }])).toBe("2 of 2 objects are not ready for go-live.");
  });
  it("never says zero objects are not ready", () => {
    expect(verdictSentence([{ ...one, readiness: "pass" }, { ...one, module: "fi_gl", readiness: "pass" }])).toBe("All 2 objects are ready for go-live.");
  });
});
