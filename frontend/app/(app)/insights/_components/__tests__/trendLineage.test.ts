// frontend/app/(app)/insights/_components/__tests__/trendLineage.test.ts
import { describe, expect, it } from "vitest";
import type { TrendRun } from "@/lib/api/insights";
import type { Version } from "@/types/api";
import { scopeTrendRuns, scopedComparisons, trendDomain, trendPoints } from "../trendLineage";

const tr = (id: string, at: string | null, composite: number | null, modules: string[], label = id): TrendRun => ({
  version_id: id, label, run_at: at, baseline: false, composite,
  dimensions: composite === null ? {} : { completeness: composite },
  modules: Object.fromEntries(modules.map((m) => [m, {}])), critical: 0, high: 0, failing_rules: 0, affected_records: 0,
  blockers: 0, auto_fixable_pct: null, change: null, rules_fixed: null, rules_new: null,
});
const upload = (id: string): Version => ({ id, label: id, status: "complete", run_at: "2026-10-02T00:00:00Z", dqs_summary: null, metadata: { modules: [], file_name: "f", row_count: 1 } });

const runs = [
  tr("co1", "2026-10-02T09:00:00Z", 70, ["controlling"], "controlling_1k"),
  tr("bp1", "2026-10-16T05:00:00Z", 70, ["business_partner"], "business_partner_1k"),
  tr("hcm", "2026-10-16T06:00:00Z", 64.5, ["hcm"], "hcm_1k"),
  tr("bp2", "2026-10-16T17:30:00Z", 81.8, ["business_partner"], "business_partner_100k"),
];

describe("scopeTrendRuns", () => {
  it("narrows an upload's series to runs carrying the same objects", () => {
    expect(scopeTrendRuns(runs, upload("bp2"), "bp2").map((r) => r.version_id)).toEqual(["bp1", "bp2"]);
  });
  it("keeps the whole series for a system run, which the API already scopes", () => {
    const sys: Version = { ...upload("bp2"), metadata: { modules: [], file_name: "f", row_count: 1, system_id: "sys-1" } };
    expect(scopeTrendRuns(runs, sys, "bp2")).toBe(runs);
  });
  it("keeps the series only while the current run is unknown", () => {
    expect(scopeTrendRuns(runs, undefined, "bp2")).toBe(runs);
  });
  it("scopes by the current upload's own objects when it fell outside the endpoint's window, never the mixed series", () => {
    const older: Version = { ...upload("bp0"), metadata: { modules: ["business_partner"], file_name: "f", row_count: 1 } };
    expect(scopeTrendRuns(runs, older, "bp0").map((r) => r.version_id)).toEqual(["bp1", "bp2"]);
    expect(scopeTrendRuns(runs, upload("zzz"), "zzz")).toEqual([]);
  });
});

describe("trendPoints and trendDomain", () => {
  it("keys x by run id and labels every run in one format: date and time on every tick when two runs share a day", () => {
    const pts = trendPoints(runs, (r) => r.composite);
    expect(pts.map((p) => p.x)).toEqual(["co1", "bp1", "hcm", "bp2"]);
    expect(pts.map((p) => p.label)).toEqual(["2 Oct 2026, 09:00", "16 Oct 2026, 05:00", "16 Oct 2026, 06:00", "16 Oct 2026, 17:30"]);
    expect(pts.map((p) => p.label)).not.toContain("business_partner_100k");
    expect(pts[3]).toMatchObject({ y: 81.8, runId: "bp2" });
  });
  it("drops runs where the value is missing but keeps them in the shared domain", () => {
    const withGap = [...runs, tr("gap", "2026-10-17T00:00:00Z", null, ["business_partner"])];
    expect(trendPoints(withGap, (r) => r.dimensions.completeness).map((p) => p.x)).toEqual(["co1", "bp1", "hcm", "bp2"]);
    expect(trendDomain(withGap).map((d) => d.x)).toEqual(["co1", "bp1", "hcm", "bp2", "gap"]);
    expect(trendDomain(withGap)[4].label).toBe("17 Oct 2026, 00:00");
  });
});

describe("scopedComparisons", () => {
  const a = { ...tr("a", "2026-10-01T00:00:00Z", 60, ["bp", "mm"]), change: null, rules_fixed: null, rules_new: null };
  const b = { ...tr("b", "2026-10-02T00:00:00Z", 65, ["bp"]), change: 5, rules_fixed: 2, rules_new: 0 };
  const c = { ...tr("c", "2026-10-03T00:00:00Z", 70, ["bp", "mm"]), change: 5, rules_fixed: 1, rules_new: 3 };

  it("keeps the API comparisons when the predecessor is shown", () => {
    expect(scopedComparisons([a, b, c], [a, b, c])).toEqual([a, b, c]);
  });

  it("re-reads a run against the run shown before it when scoping hid its predecessor", () => {
    const [first, last] = scopedComparisons([a, b, c], [a, c]);
    expect(first).toEqual(a);
    expect(last).toEqual({ ...c, change: 10, rules_fixed: null, rules_new: null });
  });

  it("makes the first shown run a first run when its predecessor is hidden", () => {
    expect(scopedComparisons([a, b, c], [c])[0]).toEqual({ ...c, change: null, rules_fixed: null, rules_new: null });
  });
});
