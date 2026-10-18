import { describe, expect, it } from "vitest";
import type { DQSSummary, Version } from "@/types/api";
import {
  blockingTotal, isScored, latestPerLineage, runObjectsName, stateDqs, stateObjects, stateRows, stateScopeLine, stateSeries, stateSummary, tierOf,
} from "../current-state";
import { runDimensions } from "../home-metrics";

const summary = (score: number | null, over: Partial<DQSSummary> = {}): DQSSummary => ({
  composite_score: score,
  dimension_scores: { completeness: score ?? 0, accuracy: score ?? 0, consistency: score ?? 0, timeliness: score ?? 0, uniqueness: score ?? 0, validity: score ?? 0 },
  critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 10, passing_checks: 10, capped: false, cap_reason: null,
  ...over,
});

/** An upload of `scores`' objects (its lineage is those objects), or a system run with `system`. */
function run(id: string, runAt: string, scores: Record<string, number | null | DQSSummary>, over: Partial<Version> & { system?: string } = {}): Version {
  const { system, ...rest } = over;
  return {
    id, run_at: runAt, label: `${Object.keys(scores).join("+")}_1k`, status: "agents_complete",
    dqs_summary: Object.fromEntries(Object.entries(scores).map(([m, s]) => [m, typeof s === "object" && s !== null ? s : summary(s)])),
    metadata: system ? { system_id: system } : { modules: Object.keys(scores) },
    ...rest,
  };
}

// The sim's shape: ten uploads of controlling (the newest), one each of two other objects, and a system run that
// also measured accounts payable before it was uploaded.
const CONTROLLING = Array.from({ length: 10 }, (_, i) => run(`co${i}`, `2026-10-16T05:17:${String(30 + i).padStart(2, "0")}Z`, { controlling: 60 + i }));
const MM = run("mm", "2026-10-16T03:05:18Z", { material_master: 95 });
const AP_UPLOAD = run("ap-up", "2026-10-16T03:01:18Z", { accounts_payable: 80 });
const AP_SYSTEM = run("ap-sys", "2026-10-02T05:09:17Z", { accounts_payable: 50, business_partner: 70 }, { system: "sys-1" });
const ALL = [...CONTROLLING, MM, AP_UPLOAD, AP_SYSTEM];

describe("latestPerLineage", () => {
  it("keeps the latest scored run of each lineage, newest first", () => {
    expect(latestPerLineage(ALL).map((v) => v.id)).toEqual(["co9", "mm", "ap-up", "ap-sys"]);
  });

  it("skips runs that are not finished or carry no scores", () => {
    const running = run("co-run", "2026-10-17T00:00:00Z", { controlling: 10 }, { status: "running" });
    const empty = run("co-empty", "2026-10-17T00:00:01Z", {}, { metadata: { modules: ["controlling"] } });
    expect(isScored(running)).toBe(false);
    expect(isScored(empty)).toBe(false);
    expect(latestPerLineage([...ALL, running, empty])[0].id).toBe("co9");
  });
});

describe("stateObjects", () => {
  it("takes each object once, from the newest current run that measured it", () => {
    const objects = stateObjects(latestPerLineage(ALL));
    expect(objects.map((o) => [o.module, o.run.id, o.summary.composite_score])).toEqual([
      ["accounts_payable", "ap-up", 80],
      ["business_partner", "ap-sys", 70],
      ["controlling", "co9", 69],
      ["material_master", "mm", 95],
    ]);
  });

  it("keeps only in-scope modules for a module-scoped user", () => {
    expect(stateObjects(latestPerLineage(ALL), new Set(["controlling"])).map((o) => o.module)).toEqual(["controlling"]);
  });

  it("feeds the per-run metrics through one merged summary", () => {
    const objects = stateObjects(latestPerLineage(ALL));
    expect(stateDqs(objects)).toBe(78.5); // (80 + 70 + 69 + 95) / 4
    expect(runDimensions(stateSummary(objects))?.completeness).toBe(78.5);
    expect(stateDqs([])).toBeNull();
  });
});

describe("stateRows", () => {
  const objects = stateObjects(latestPerLineage(ALL));
  const aggregate = {
    version_ids: ["co9", "mm", "ap-up", "ap-sys"],
    by_module: [
      { module: "controlling", findings: 5, affected: 120, critical: 0, high: 0, medium: 0, low: 0, avg_pass_rate: null },
      { module: "accounts_payable", findings: 9, affected: 900, critical: 0, high: 0, medium: 0, low: 0, avg_pass_rate: null },
    ],
  };

  it("gives each row its object's run, readiness by the tenant's bands and failing checks by severity", () => {
    const capped = stateObjects([run("x", "2026-10-16T00:00:00Z", { fi_gl: summary(72, { critical_count: 2, high_count: 3, medium_count: 1, low_count: 1 }) })]);
    const [row] = stateRows(capped, { target: 90, warning: 75, critical: 60 });
    expect(row).toMatchObject({ module: "fi_gl", label: "FI general ledger", composite_score: 72, readiness: "fail", failing_checks: 7, critical_checks: 2, high_checks: 3, run_id: "x" });
  });

  it("takes affected records from the aggregate only when that object's run alone measured it", () => {
    const rows = new Map(stateRows(objects, undefined, aggregate, ALL).map((r) => [r.module, r.affected_records]));
    expect(rows.get("controlling")).toBe(120);
    expect(rows.get("material_master")).toBe(0); // in the aggregate's runs, nothing failing
    expect(rows.get("accounts_payable")).toBeNull(); // the aggregate sums the upload and the system run
    expect(stateRows(objects).every((r) => r.affected_records === null)).toBe(true); // aggregate not loaded
  });
});

describe("tierOf", () => {
  it("matches the API's tier bands", () => {
    expect(tierOf(90)).toBe("pass");
    expect(tierOf(89.9)).toBe("warn");
    expect(tierOf(74.9)).toBe("fail");
    expect(tierOf(null)).toBeNull();
    expect(tierOf(80, { target: 80, warning: 70, critical: 50 })).toBe("pass");
  });
});

describe("blockingTotal", () => {
  it("sums failing critical and high checks across objects", () => {
    const objects = stateObjects([
      run("a", "2026-10-16T00:00:00Z", { fi_gl: summary(70, { critical_count: 2, high_count: 3, medium_count: 9 }) }),
      run("b", "2026-10-15T00:00:00Z", { hcm: summary(70, { critical_count: 1, high_count: 0 }) }),
    ]);
    expect(blockingTotal(objects)).toBe(6);
  });
});

describe("stateSeries", () => {
  it("scores every object at its latest run as of each run, so the last step is the newest run's change", () => {
    const points = stateSeries([run("a1", "2026-10-01T00:00:00Z", { fi_gl: 60 }), run("b1", "2026-10-02T00:00:00Z", { hcm: 80 }), run("a2", "2026-10-03T00:00:00Z", { fi_gl: 70 })]);
    expect(points.map((p) => [p.runId, p.y])).toEqual([["a1", 60], ["b1", 70], ["a2", 75]]);
    expect(points.map((p) => p.label)).toEqual(["1 Oct 2026", "2 Oct 2026", "3 Oct 2026"]);
  });

  it("follows the module scope", () => {
    const points = stateSeries([run("a1", "2026-10-01T00:00:00Z", { fi_gl: 60 }), run("b1", "2026-10-02T00:00:00Z", { hcm: 80 })], new Set(["hcm"]));
    expect(points.map((p) => [p.runId, p.y])).toEqual([["b1", 80]]);
  });
});

describe("copy", () => {
  it("names the current state, not one run", () => {
    expect(stateScopeLine(16, "2026-10-16T05:17:46Z")).toBe("Current state of 16 objects, latest run 16 Oct 2026");
    expect(stateScopeLine(1, "2026-10-16T05:17:46Z")).toBe("Current state of 1 object, latest run 16 Oct 2026");
  });

  it("names a run's objects", () => {
    expect(runObjectsName(MM)).toBe("Material Master");
    expect(runObjectsName(AP_SYSTEM)).toBe("these 2 objects");
  });
});
