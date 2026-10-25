import { describe, expect, it } from "vitest";
import type { DQSSummary, Version } from "@/types/api";
import { CURRENT_STATE_VIEWS, ONE_RUN_VIEWS, insightRunChoices, insightScopeMode } from "../scopeMode";
import { currentStateOf } from "../useCurrentState";
import { VIEWS } from "../InsightViews";

const summary = (score: number, critical = 0, high = 0): DQSSummary => ({
  composite_score: score,
  dimension_scores: { completeness: score, accuracy: score, consistency: score, timeliness: score, uniqueness: score, validity: score },
  critical_count: critical, high_count: high, medium_count: 0, low_count: 0,
  total_checks: 10, passing_checks: 10 - critical - high, capped: false, cap_reason: null,
});

const run = (id: string, run_at: string, modules: Record<string, DQSSummary>, label?: string): Version =>
  ({ id, label: label ?? null, run_at, status: "complete", dqs_summary: modules, metadata: { modules: Object.keys(modules) } }) as unknown as Version;

// Two uploads of controlling (the newest run of the tenant) and one each of material master and accounts payable.
const versions = [
  run("co2", "2026-10-16T05:17:00Z", { controlling: summary(60, 1, 2) }, "controlling_1k"),
  run("co1", "2026-10-15T05:17:00Z", { controlling: summary(50) }, "controlling_1k"),
  run("mm1", "2026-10-16T03:05:00Z", { material_master: summary(80, 0, 1) }, "material_master_25k"),
  run("ap1", "2026-10-16T03:01:00Z", { accounts_payable: summary(90) }, "accounts_payable_p02"),
];

describe("insightScopeMode", () => {
  it("is the current state on the overview without ?run= or ?module=", () => {
    expect(insightScopeMode("/insights", {})).toBe("current");
    expect(insightScopeMode("/insights", { explicit: null, module: null })).toBe("current");
  });

  it("is the current state on the executive summary too, so it answers with Home's number", () => {
    expect(insightScopeMode("/insights/exec", {})).toBe("current");
    expect(insightScopeMode("/insights/exec", { explicit: "co1" })).toBe("run");
  });

  it("is one run with ?run=, or with an object filter that pins one lineage", () => {
    expect(insightScopeMode("/insights", { explicit: "co1" })).toBe("run");
    expect(insightScopeMode("/insights", { module: "material_master" })).toBe("run");
  });

  it("is always one run on a view whose endpoint answers one run", () => {
    for (const path of ONE_RUN_VIEWS) expect(insightScopeMode(path, {})).toBe("run");
  });

  it("lists only real insight tabs, and never a view as both", () => {
    const tabs = new Set(VIEWS.flatMap((v) => v.tabs.map(([href]) => href)));
    for (const path of [...CURRENT_STATE_VIEWS, ...ONE_RUN_VIEWS]) expect(tabs.has(path)).toBe(true);
    expect(ONE_RUN_VIEWS.filter((p) => CURRENT_STATE_VIEWS.includes(p))).toEqual([]);
    expect(CURRENT_STATE_VIEWS).toContain("/insights/exec");
    expect(ONE_RUN_VIEWS).toContain("/insights/trends");
  });
});

describe("currentStateOf", () => {
  it("takes each object from the latest run of its lineage, as the homes do", () => {
    const s = currentStateOf(versions, null);
    expect(s.objects.map((o) => [o.module, o.run.id])).toEqual([
      ["accounts_payable", "ap1"], ["controlling", "co2"], ["material_master", "mm1"],
    ]);
    expect(s.runs.map((r) => r.id)).toEqual(["co2", "mm1", "ap1"]);
    expect(s.newest?.id).toBe("co2");
  });

  it("keeps only in-scope objects for a module-scoped user", () => {
    const s = currentStateOf(versions, new Set(["material_master"]));
    expect(s.objects.map((o) => o.module)).toEqual(["material_master"]);
    expect(s.newest?.id).toBe("mm1");
  });
});

describe("insightRunChoices", () => {
  it("offers the shown run's lineage and every other lineage's latest run, newest first", () => {
    expect(insightRunChoices(versions[0], versions).map((v) => v.id)).toEqual(["co2", "mm1", "ap1", "co1"]);
    expect(insightRunChoices(versions[2], versions).map((v) => v.id)).toEqual(["co2", "mm1", "ap1"]);
  });
});
