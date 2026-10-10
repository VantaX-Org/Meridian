import { describe, expect, it } from "vitest";
import type { Version } from "@/types/api";
import {
  cappedReason,
  delta,
  dimensionBarPoints,
  dimensionHeatmapCells,
  objectTrend,
  readinessOf,
  runDimensions,
  runDqs,
  severityTotals,
  trend,
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
  it("readinessOf applies the ScoreRing thresholds", () => {
    expect(readinessOf(90)).toBe("go");
    expect(readinessOf(85)).toBe("go");
    expect(readinessOf(70)).toBe("at-risk");
    expect(readinessOf(59)).toBe("no-go");
  });

  it("runDqs averages composite_score across modules, or null with none", () => {
    expect(runDqs(version("v1", "2026-01-01", { material_master: 80, business_partner: 90 }))).toBe(85);
    expect(runDqs(version("v1", "2026-01-01", {}))).toBeNull();
  });

  it("runDimensions averages each dimension across modules, or null with none", () => {
    expect(runDimensions(version("v1", "2026-01-01", { material_master: 80, business_partner: 90 }))).toEqual(dims(85));
    expect(runDimensions(version("v1", "2026-01-01", {}))).toBeNull();
  });

  it("trend keeps only finished versions, oldest first", () => {
    const pending = version("v0", "2026-01-01", {});
    const first = version("v1", "2026-01-02", { material_master: 70 });
    const second = version("v2", "2026-01-03", { material_master: 80 });
    expect(trend([second, pending, first])).toEqual([
      { x: "2 Jan 2026", y: 70, runId: "v1" },
      { x: "3 Jan 2026", y: 80, runId: "v2" },
    ]);
  });

  it("delta is the change from the previous finished run, or null with fewer than two", () => {
    expect(delta([{ x: "a", y: 70, runId: "v1" }])).toBeNull();
    expect(delta([{ x: "a", y: 70, runId: "v1" }, { x: "b", y: 85.4, runId: "v2" }])).toBe(15.4);
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
    expect(points[0]).toEqual({ x: "Completeness", y: 80, dimension: "completeness" });
  });

  it("dimensionHeatmapCells builds one cell per object x dimension for modules present in the run", () => {
    const v = version("v1", "2026-01-01", { material_master: 90 });
    const cells = dimensionHeatmapCells(
      [{ module: "material_master", label: "Material Master", composite_score: 90, readiness: "pass", failing_checks: 0, affected_records: 0 }],
      v,
    );
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ row: "Material Master", col: "Completeness", value: "go" });
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
