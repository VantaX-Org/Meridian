import { describe, expect, it } from "vitest";
import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { compareNarrative } from "../narrative";

const nf = new Intl.NumberFormat("en-ZA");

const version = (id: string) => ({ id, label: null, status: "complete" as const, run_at: "2026-10-08T00:00:00Z", dqs_summary: null, metadata: null });

function cmp(over: Partial<VersionComparison> = {}): VersionComparison {
  return {
    v1: version("v1"),
    v2: version("v2"),
    delta: {
      material_master: { dqs_change: 6.1, v1_score: 70.0, v2_score: 76.1, dimensions: { validity: { v1: 60, v2: 69, change: 9 }, completeness: { v1: 80, v2: 81, change: 1 } } },
      fi_gl: { dqs_change: 1.0, v1_score: 72.4, v2_score: 73.4, dimensions: {} },
    },
    checks: {
      newly_failing: [
        { check_id: "MM077", module: "material_master", severity: "high", v1_affected: 0, v2_affected: 88 },
        { check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 },
      ],
      fixed: [
        { check_id: "FI001", module: "fi_gl", severity: "low", v1_affected: 10, v2_affected: 0 },
        { check_id: "FI002", module: "fi_gl", severity: "low", v1_affected: 10, v2_affected: 0 },
      ],
    },
    ...over,
  };
}

const diff: RecordDiff = {
  v1: "v1", v2: "v2",
  totals: { new: 1328, resolved: 3410, persisting: 5 },
  checks: [
    { check_id: "MM041", module: "material_master", severity: "critical", new: 1240, resolved: 0, persisting: 0, comparable: true },
    { check_id: "X1", module: "fi_gl", severity: "low", new: 0, resolved: 0, persisting: 0, comparable: false },
    { check_id: "X2", module: "fi_gl", severity: "low", new: 0, resolved: 0, persisting: 0, comparable: false },
  ],
};

describe("compareNarrative", () => {
  it("writes every sentence in order", () => {
    expect(compareNarrative(cmp(), diff)).toEqual([
      "DQS moved from 71.2 to 74.8 (+3.6) across 2 modules.",
      "Material Master improved most (+6.1), driven by validity (+9.0).",
      `2 checks newly fail: MM041 (critical, ${nf.format(1240)} records), MM077 (high, ${nf.format(88)} records).`,
      `2 checks fixed, ${nf.format(3410)} records resolved.`,
      "2 checks did not run cleanly in both runs; their deltas are excluded.",
    ]);
  });

  it("omits empty sentences and handles the null diff", () => {
    const out = compareNarrative(cmp({ delta: {}, checks: { newly_failing: [], fixed: [cmp().checks.fixed[0]] } }), null);
    expect(out).toEqual(["1 check fixed."]);
  });

  it("names a decline and caps the regression list at three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ check_id: `C${i}`, module: "fi_gl", severity: "low", v1_affected: 0, v2_affected: 10 - i }));
    const out = compareNarrative(
      cmp({ delta: { fi_gl: { dqs_change: -2, v1_score: 70, v2_score: 68, dimensions: { accuracy: { v1: 50, v2: 46, change: -4 } } } }, checks: { newly_failing: many, fixed: [] } }),
      null,
    );
    expect(out[0]).toBe("DQS moved from 70.0 to 68.0 (-2.0) across 1 module.");
    expect(out[1]).toBe("Fi Gl declined most (-2.0), driven by accuracy (-4.0).");
    expect(out[2]).toBe("5 checks newly fail: C0 (low, 10 records), C1 (low, 9 records), C2 (low, 8 records), and 2 more.");
    expect(out).toHaveLength(3);
  });
});
