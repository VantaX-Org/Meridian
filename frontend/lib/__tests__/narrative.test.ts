import { describe, expect, it } from "vitest";
import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { compareNarrative } from "../narrative";
import { formatNumber } from "../format";

const nf = { format: (n: number) => formatNumber(n) };

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
      "DQS moved from 71.2 to 74.8 (+3.6) across 2 objects.",
      "Material master improved most (+6.1), driven by validity (+9.0).",
      `2 rules newly fail: MM041 (critical, ${nf.format(1240)} records), MM077 (high, ${nf.format(88)} records).`,
      `2 rules fixed, which had 20 rule failures; across every rule, ${nf.format(3410)} rule failures resolved and ${nf.format(1328)} new.`,
      "Net, rule failures fell by 2,082.",
      "2 rules did not run cleanly in both runs; their deltas are excluded.",
    ]);
  });

  it("explains a score that improved while rule failures rose, and one that fell while they fell", () => {
    // accounts_payable_p06 vs p02: DQS +0.4 beside 10,521 resolved and 11,151 new rule failures (630 more).
    const delta = { accounts_payable: { dqs_change: 0.4, v1_score: 82.5, v2_score: 82.9, dimensions: {} } };
    const base = cmp({ delta, checks: { newly_failing: [], fixed: [] } });
    const rose = compareNarrative(base, { ...diff, totals: { new: 11151, resolved: 10521, persisting: 0 }, checks: [] });
    expect(rose).toContain(`Net, rule failures rose by 630 while the score improved: the score weighs each object's rule pass rates and is held down by caps, so it does not move with the count of failures.`);
    const down = { accounts_payable: { dqs_change: -0.4, v1_score: 82.9, v2_score: 82.5, dimensions: {} } };
    const fell = compareNarrative(cmp({ delta: down, checks: { newly_failing: [], fixed: [] } }), { ...diff, totals: { new: 10, resolved: 20, persisting: 0 }, checks: [] });
    expect(fell).toContain("Net, rule failures fell by 10 while the score declined: the score weighs each object's rule pass rates and is held down by caps, so it does not move with the count of failures.");
    // Moving together, or no net change: no explanation is needed.
    expect(compareNarrative(base, { ...diff, totals: { new: 5, resolved: 20, persisting: 0 }, checks: [] })).toContain("Net, rule failures fell by 15.");
    expect(compareNarrative(base, { ...diff, totals: { new: 5, resolved: 5, persisting: 0 }, checks: [] }).some((l) => l.startsWith("Net,"))).toBe(false);
  });

  it("omits empty sentences and handles the null diff", () => {
    const out = compareNarrative(cmp({ delta: {}, checks: { newly_failing: [], fixed: [cmp().checks.fixed[0]] } }), null);
    expect(out).toEqual(["1 rule fixed, which had 10 rule failures."]);
  });

  it("never puts every check's resolved records beside the fixed checks as if they were theirs", () => {
    // accounts_payable_p06 vs p02: 4 fixed checks held 6 records; 10,521 records were resolved across every check.
    const fixed = [1, 1, 2, 2].map((n, i) => ({ check_id: `F${i}`, module: "accounts_payable", severity: "medium", v1_affected: n, v2_affected: 0 }));
    const out = compareNarrative(cmp({ delta: {}, checks: { newly_failing: [], fixed } }), { ...diff, totals: { new: 11151, resolved: 10521, persisting: 34301 }, checks: [] });
    expect(out[0]).toBe(`4 rules fixed, which had 6 rule failures; across every rule, ${nf.format(10521)} rule failures resolved and ${nf.format(11151)} new.`);
  });

  it("names a driver that moved the same way as the score, and one that moved against it as such", () => {
    // accounts_payable_p02 vs p06: +0.4 with uniqueness -0.9 the largest dimension move. It read "improved most
    // (+0.4), driven by uniqueness (-0.9)".
    const delta = { accounts_payable: { dqs_change: 0.4, v1_score: 82.5, v2_score: 82.9, dimensions: {
      uniqueness: { v1: 80, v2: 79.1, change: -0.9 }, validity: { v1: 90, v2: 90.6, change: 0.6 }, accuracy: { v1: 85, v2: 85, change: 0 },
    } } };
    const out = compareNarrative(cmp({ delta, checks: { newly_failing: [], fixed: [] } }), null);
    expect(out[1]).toBe("Accounts payable improved most (+0.4), driven by validity (+0.6) despite uniqueness (-0.9).");
    // No dimension moved with the score: no driver is named rather than a contradicting one.
    const against = { accounts_payable: { ...delta.accounts_payable, dimensions: { uniqueness: { v1: 80, v2: 79.1, change: -0.9 } } } };
    expect(compareNarrative(cmp({ delta: against, checks: { newly_failing: [], fixed: [] } }), null)[1]).toBe("Accounts payable improved most (+0.4).");
  });

  it("names a decline and caps the regression list at three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ check_id: `C${i}`, module: "fi_gl", severity: "low", v1_affected: 0, v2_affected: 10 - i }));
    const out = compareNarrative(
      cmp({ delta: { fi_gl: { dqs_change: -2, v1_score: 70, v2_score: 68, dimensions: { accuracy: { v1: 50, v2: 46, change: -4 } } } }, checks: { newly_failing: many, fixed: [] } }),
      null,
    );
    expect(out[0]).toBe("DQS moved from 70.0 to 68.0 (-2.0) across 1 object.");
    expect(out[1]).toBe("FI general ledger declined most (-2.0), driven by accuracy (-4.0).");
    expect(out[2]).toBe("5 rules newly fail: C0 (low, 10 records), C1 (low, 9 records), C2 (low, 8 records), and 2 more.");
    expect(out).toHaveLength(3);
  });
});
