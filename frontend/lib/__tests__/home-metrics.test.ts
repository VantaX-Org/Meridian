import { describe, expect, it } from "vitest";
import type { Version } from "@/types/api";
import {
  cappedReason,
  delta,
  dimensionBarPoints,
  dimensionHeatmapCells,
  objectTrend,
  readinessOf,
  runCap,
  runDimensions,
  runDqs,
  severityTotals,
  trend,
  unmeasuredDimensions,
  worstObjectsFirst,
} from "../home-metrics";

const dims = (base: number) => ({
  completeness: base, accuracy: base, consistency: base, timeliness: base, uniqueness: base, validity: base,
});

function version(id: string, runAt: string, scores: Record<string, number>, overrides: Partial<Version> = {}): Version {
  return {
    id,
    run_at: runAt,
    label: null,
    status: "complete",
    dqs_summary: Object.fromEntries(
      Object.entries(scores).map(([module, score]) => [
        module,
        {
          composite_score: score,
          dimension_scores: dims(score),
          critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
          total_checks: 10, passing_checks: 8, capped: false, cap_reason: null,
        },
      ]),
    ),
    metadata: null,
    ...overrides,
  };
}

describe("home-metrics", () => {
  it("readinessOf applies the ScoreRing bands (target 90, warning 75 by default)", () => {
    expect(readinessOf(90)).toBe("go");
    expect(readinessOf(85)).toBe("at-risk");
    expect(readinessOf(75)).toBe("at-risk");
    expect(readinessOf(74)).toBe("no-go");
    expect(readinessOf(85, { target: 85, warning: 60, critical: 50 })).toBe("go");
    expect(readinessOf(70, { target: 85, warning: 60, critical: 50 })).toBe("at-risk");
  });

  it("runDqs averages composite_score across modules, or null with none", () => {
    expect(runDqs(version("v1", "2026-01-01", { material_master: 80, business_partner: 90 }))).toBe(85);
    expect(runDqs(version("v1", "2026-01-01", {}))).toBeNull();
  });

  it("runDimensions averages each dimension across modules, or null with none", () => {
    expect(runDimensions(version("v1", "2026-01-01", { material_master: 80, business_partner: 90 }))).toEqual(dims(85));
    expect(runDimensions(version("v1", "2026-01-01", {}))).toBeNull();
  });

  it("runDimensions skips dimensions a module did not measure and nulls those no module measured", () => {
    const v = version("v1", "2026-01-01", { material_master: 80, business_partner: 90 });
    v.dqs_summary!.material_master.dimension_coverage = { accuracy: 0, timeliness: 0 };
    v.dqs_summary!.business_partner.dimension_coverage = { timeliness: 0 };
    const d = runDimensions(v)!;
    expect(d.accuracy).toBe(90); // material master's placeholder is not averaged in
    expect(d.completeness).toBe(85);
    expect(d.timeliness).toBeNull();
    expect(unmeasuredDimensions(v)).toEqual(["Timeliness"]);
    expect(dimensionBarPoints(v).map((p) => p.dimension)).not.toContain("timeliness");
  });

  it("runDimensions ignores modules with no composite_score, as runDqs does", () => {
    const v = version("v1", "2026-01-01", { material_master: 80, business_partner: 0 });
    v.dqs_summary!.business_partner.composite_score = null;
    expect(runDqs(v)).toBe(80);
    expect(runDimensions(v)).toEqual(dims(80)); // not dragged to 40 by the unmeasured module's zeros
    const none = version("v2", "2026-01-01", { business_partner: 0 });
    none.dqs_summary!.business_partner.composite_score = null;
    expect(runDimensions(none)).toBeNull();
  });

  it("runDimensions keeps a module with measured dimensions but no composite (every measured dimension weighted 0)", () => {
    const v = version("v1", "2026-01-01", { material_master: 60 });
    const m = v.dqs_summary!.material_master;
    m.composite_score = null;
    m.dimension_coverage = { completeness: 5, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
    expect(runDqs(v)).toBeNull();
    const d = runDimensions(v)!;
    expect(d.completeness).toBe(60);
    expect(d.accuracy).toBeNull();
  });

  it("trend keeps only finished versions, oldest first", () => {
    const pending = version("v0", "2026-01-01", {});
    const first = version("v1", "2026-01-02", { material_master: 70 });
    const second = version("v2", "2026-01-03", { material_master: 80 });
    expect(trend([second, pending, first])).toEqual([
      { x: "v1", label: "2 Jan 2026", y: 70, runId: "v1" },
      { x: "v2", label: "3 Jan 2026", y: 80, runId: "v2" },
    ]);
  });

  it("trend labels two runs of one day with their time, and follows only the current run's lineage", () => {
    const morning = version("v1", "2026-01-02T05:00:00Z", { material_master: 70 });
    const evening = version("v2", "2026-01-02T17:30:00Z", { material_master: 80 });
    const other = version("v3", "2026-01-03T09:00:00Z", { fi_gl: 95 });
    const all = trend([other, evening, morning], evening);
    expect(all.map((p) => p.runId)).toEqual(["v1", "v2"]);
    expect(all.map((p) => p.label)).toEqual(["2 Jan 2026, 05:00", "2 Jan 2026, 17:30"]);
    expect(trend([other, evening, morning]).map((p) => p.runId)).toEqual(["v1", "v2", "v3"]);
  });

  it("delta is the change from the previous finished run, or null with fewer than two", () => {
    expect(delta([{ x: "a", label: "a", y: 70, runId: "v1" }])).toBeNull();
    expect(delta([{ x: "a", label: "a", y: 70, runId: "v1" }, { x: "b", label: "b", y: 85.4, runId: "v2" }])).toBe(15.4);
  });

  it("severityTotals sums every module's counts", () => {
    const v = version("v1", "2026-01-01", { a: 80, b: 90 });
    v.dqs_summary!.a.critical_count = 2;
    v.dqs_summary!.b.critical_count = 3;
    v.dqs_summary!.a.high_count = 1;
    expect(severityTotals(v)).toEqual({ critical: 5, high: 1, medium: 0, low: 0 });
  });

  it("cappedReason returns the first capped module's reason, or null", () => {
    const v = version("v1", "2026-01-01", { a: 80, b: 90 });
    expect(cappedReason(v)).toBeNull();
    v.dqs_summary!.b.capped = true;
    v.dqs_summary!.b.cap_reason = "A critical finding caps the score.";
    expect(cappedReason(v)).toBe("A critical finding caps the score.");
  });

  it("dimensionBarPoints labels each of the six dimensions", () => {
    const points = dimensionBarPoints(version("v1", "2026-01-01", { a: 80 }));
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: "Completeness (25%)", y: 80, dimension: "completeness" });
  });

  it("dimensionHeatmapCells builds one cell per object x dimension for modules present in the run", () => {
    const v = version("v1", "2026-01-01", { material_master: 90 });
    const cells = dimensionHeatmapCells(
      [{ module: "material_master", label: "Material Master", composite_score: 90, readiness: "pass", failing_checks: 0, affected_records: 0 }],
      v,
    );
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ row: "Material Master", col: "Completeness", value: 90, tone: "go" });
  });

  it("worstObjectsFirst sorts ascending by composite_score and drops unscored objects", () => {
    const objects = [
      { module: "a", label: "A", composite_score: 90, readiness: "pass" as const, failing_checks: 0, affected_records: 0 },
      { module: "b", label: "B", composite_score: null, readiness: null, failing_checks: 0, affected_records: 0 },
      { module: "c", label: "C", composite_score: 60, readiness: "fail" as const, failing_checks: 5, affected_records: 10 },
    ];
    expect(worstObjectsFirst(objects).map((o) => o.module)).toEqual(["c", "a"]);
  });

  it("objectTrend follows one module's composite_score across its finished runs", () => {
    const v1 = version("v1", "2026-01-01", { material_master: 70 });
    const v2 = version("v2", "2026-01-02", { material_master: 85 });
    expect(objectTrend([v2, v1], "material_master")).toEqual([
      { x: "1 Jan 2026", y: 70 },
      { x: "2 Jan 2026", y: 85 },
    ]);
  });
});

describe("runCap", () => {
  const capped = (v: Version, modules: string[], reason: string, criticals: number): Version => {
    for (const m of modules) Object.assign(v.dqs_summary![m], { capped: true, cap_reason: reason, critical_count: criticals });
    return v;
  };

  it("is null when only some modules are capped (the run DQS is a mean)", () => {
    const v = capped(version("v1", "2026-01-01", { a: 90, b: 95 }), ["a"], "3 critical failures — score capped at 70", 3);
    expect(runCap(v)).toBeNull();
  });

  it("is null when caps differ (the mean could exceed the lowest cap)", () => {
    const v = version("v1", "2026-01-01", { a: 70, b: 85 });
    capped(v, ["a"], "3 critical failures — score capped at 70", 3);
    capped(v, ["b"], "1 critical failure — score capped at 85", 1);
    expect(runCap(v)).toBeNull();
  });

  it("is null when one capped module's reason has no parsable cap", () => {
    const v = version("v1", "2026-01-01", { a: 85, b: 85 });
    capped(v, ["a"], "1 critical failure — score capped at 85", 1);
    capped(v, ["b"], "capped", 2);
    expect(runCap(v)).toBeNull();
  });

  it("is the shared cap with summed criticals when every module is capped at 85", () => {
    const v = capped(version("v1", "2026-01-01", { a: 85, b: 80 }), ["a", "b"], "1 critical failure — score capped at 85", 1);
    expect(runCap(v)).toEqual({ cap: 85, criticals: 2 });
  });

  it("is null with no modules or no parsable cap", () => {
    expect(runCap(version("v1", "2026-01-01", {}))).toBeNull();
    expect(runCap(capped(version("v1", "2026-01-01", { a: 70 }), ["a"], "capped", 1))).toBeNull();
  });
});

describe("dimensionBarPoints weights", () => {
  it("labels each dimension with its weight share, from defaults or tenant weights", () => {
    const v = version("v1", "2026-01-01", { a: 80 });
    expect(dimensionBarPoints(v).map((p) => p.x)).toContain("Completeness (25%)");
    expect(dimensionBarPoints(v, { completeness: 1, accuracy: 1, consistency: 1, timeliness: 1, uniqueness: 1, validity: 1 })[0].x).toMatch(/17%\)$/);
  });
});
