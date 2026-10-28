import { describe, expect, it } from "vitest";
import type { Version } from "@/types/api";
import {
  capRules,
  capSentence,
  capSentenceNamed,
  capSummary,
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

describe("capRules", () => {
  it("names the rules each capped object's reason lists, once, with the object they capped", () => {
    const v = version("v1", "2026-01-01", { business_partner: 70, fi_gl: 70, mm: 95 });
    Object.assign(v.dqs_summary!.business_partner, { capped: true, cap_reason: "2 critical failures over tolerance (BP019: 4.0% of BUT000 rows; BP002: 3.1% of BUT000 rows) — score capped at 70" });
    Object.assign(v.dqs_summary!.fi_gl, { capped: true, cap_reason: "2 critical failures over tolerance (GL024: 2.0% of SKA1 rows; BP019: 1.0% of BUT000 rows) — score capped at 70" });
    expect(capRules(v)).toEqual([
      { check_id: "BP019", module: "business_partner" },
      { check_id: "BP002", module: "business_partner" },
      { check_id: "GL024", module: "fi_gl" },
    ]);
  });
  it("is empty when nothing is capped", () => {
    expect(capRules(version("v1", "2026-01-01", { a: 90 }))).toEqual([]);
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

describe("capSummary / capSentence: one unit and scope for the cap on every page", () => {
  it("counts the capping rules once across objects and the objects they cap out of those measured", () => {
    // 3 objects capped: two name their rules (BP019 shared), one names none and counts its critical failing rules;
    // the uncapped object has many critical rules within tolerance, which cap nothing and are not counted.
    const v = version("v1", "2026-01-01", { business_partner: 70, fi_gl: 70, ar: 85, mm: 60 });
    Object.assign(v.dqs_summary!.business_partner, { capped: true, critical_count: 5, cap_reason: "2 critical failures over tolerance (BP019: 4.0% of BUT000 rows; BP002: 3.1% of BUT000 rows) — score capped at 70" });
    Object.assign(v.dqs_summary!.fi_gl, { capped: true, critical_count: 2, cap_reason: "2 critical failures over tolerance (GL024: 2.0% of SKA1 rows; BP019: 1.0% of BUT000 rows) — score capped at 70" });
    Object.assign(v.dqs_summary!.ar, { capped: true, critical_count: 1, cap_reason: "1 critical failure — score capped at 85" });
    Object.assign(v.dqs_summary!.mm, { capped: false, critical_count: 60 });
    const c = capSummary(v);
    expect(c).toMatchObject({ rules: 4, capped: 3, measured: 4, cap: null });
    expect(capSentence(c)).toBe("4 critical failing rules cap 3 of 4 objects");
    expect(capSentenceNamed(c)).toBe("4 critical failing rules (BP019, BP002 and 2 more) cap 3 of 4 objects");
  });

  it("names the shared ceiling when every object is capped at it, and the score for one object", () => {
    const one = version("v1", "2026-01-01", { ar: 70 });
    Object.assign(one.dqs_summary!.ar, { capped: true, critical_count: 9, cap_reason: "2 critical failures over tolerance (AR002: 3% of KNA1 rows; AR003: 2% of KNA1 rows) — score capped at 70" });
    expect(capSentence(capSummary(one))).toBe("2 critical failing rules cap the score at 70");
    const single = version("v1", "2026-01-01", { ar: 85 });
    Object.assign(single.dqs_summary!.ar, { capped: true, critical_count: 1, cap_reason: "AR002: 3.0% of KNA1 rows — score capped at 85" });
    expect(capSentenceNamed(capSummary(single))).toBe("1 critical failing rule (AR002) caps the score at 85");
  });

  it("is null when nothing is capped", () => {
    expect(capSentence(capSummary(version("v1", "2026-01-01", { a: 90 })))).toBeNull();
  });
});
