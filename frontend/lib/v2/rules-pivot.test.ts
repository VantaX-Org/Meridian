import { describe, expect, it } from "vitest";
import type { RuleRow } from "@/lib/api/v2/types";
import { pivotRules, rankRules, type FeatureLink } from "./rules-pivot";

const rule = (check_id: string, over: Partial<RuleRow> = {}): RuleRow => ({ check_id, name: check_id, field: "MARA.X", severity: "high", affected_count: 10, total_count: 100, pass_rate: 90, value_at_risk: 100, dimension: "completeness", ...over });

describe("rankRules", () => {
  it("ranks by value at risk, then failing records, then id, and does not change its input", () => {
    const input = [rule("C", { value_at_risk: 50 }), rule("A", { value_at_risk: 100, affected_count: 5 }), rule("B", { value_at_risk: 100, affected_count: 9 }), rule("D", { value_at_risk: null, affected_count: 999 }), rule("E", { value_at_risk: 50 })];
    const ids = rankRules(input).map((r) => r.check_id);
    expect(ids).toEqual(["B", "A", "C", "E", "D"]);
    expect(input.map((r) => r.check_id)).toEqual(["C", "A", "B", "D", "E"]);
  });
});

describe("pivotRules", () => {
  const ranked = rankRules([
    rule("A", { value_at_risk: 400, dimension: "validity", severity: "critical", field: "MARA.MEINS", affected_count: 30 }),
    rule("B", { value_at_risk: 200, dimension: "completeness", severity: "high", field: "MARA.MATKL", affected_count: 20 }),
    rule("C", { value_at_risk: 100, dimension: "completeness", severity: "low", field: "MARA.MATKL", affected_count: 10 }),
    rule("D", { value_at_risk: null, dimension: null, severity: "medium", field: null, affected_count: 5 }),
  ]);
  const none = new Map<string, FeatureLink[]>();

  it("sums rules, failing rows and value at risk per dimension, biggest value first, unset last", () => {
    const g = pivotRules(ranked, "dimension", none);
    expect(g.map((x) => [x.label, x.rules.length, x.failing, x.value])).toEqual([
      ["Validity", 1, 30, 400],
      ["Completeness", 2, 30, 300],
      ["No dimension recorded", 1, 5, null],
    ]);
  });

  it("orders severities critical to low", () => {
    expect(pivotRules(ranked, "severity", none).map((x) => x.label)).toEqual(["Critical", "High", "Medium", "Low"]);
  });

  it("groups by field, with a group for rules that have none", () => {
    const g = pivotRules(ranked, "field", none);
    expect(g.map((x) => x.label)).toEqual(["MARA.MEINS", "MARA.MATKL", "No field recorded"]);
    expect(g[0].mono).toBe(true);
    expect(g[2].mono).toBe(false);
  });

  it("counts a rule under every feature it touches and leaves the unmapped for last", () => {
    const features = new Map<string, FeatureLink[]>([
      ["A", [{ feature: "Cockpit", status: "blocked" }, { feature: "ATP", status: "degraded" }]],
      ["B", [{ feature: "ATP", status: "degraded" }]],
    ]);
    const g = pivotRules(ranked, "feature", features);
    expect(g.map((x) => [x.label, x.sub, x.rules.map((r) => r.check_id)])).toEqual([
      ["ATP", "Degraded", ["A", "B"]],
      ["Cockpit", "Blocked", ["A"]],
      ["No S/4 feature", undefined, ["C", "D"]],
    ]);
  });
});
