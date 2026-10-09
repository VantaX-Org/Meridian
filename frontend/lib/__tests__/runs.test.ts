import { describe, expect, it } from "vitest";
import type { Version, DQSSummary } from "@/types/api";
import { baselineRunId, overallDqs, previousRunId, runSeries, scopeOf } from "../runs";

function dqs(composite_score: number): DQSSummary {
  return {
    composite_score,
    dimension_scores: {
      completeness: 0,
      accuracy: 0,
      consistency: 0,
      timeliness: 0,
      uniqueness: 0,
      validity: 0,
    },
    critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
    total_checks: 0, passing_checks: 0, capped: false, cap_reason: null,
  };
}

function run(over: Partial<Version> & { id: string }): Version {
  return {
    label: null,
    status: "complete",
    run_at: "2026-10-01T00:00:00Z",
    dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
    ...over,
  };
}

describe("overallDqs", () => {
  it("returns null when there is no summary", () => {
    expect(overallDqs(run({ id: "a" }))).toBeNull();
    expect(overallDqs(run({ id: "a", dqs_summary: {} }))).toBeNull();
  });
  it("averages module composite scores", () => {
    const v = run({ id: "a", dqs_summary: { material_master: dqs(70), fi_gl: dqs(80) } });
    expect(overallDqs(v)).toBe(75);
  });
});

describe("scopeOf", () => {
  it("falls back to upload without a system id", () => {
    expect(scopeOf(run({ id: "a", metadata: null }))).toBe("upload");
    expect(scopeOf(run({ id: "a" }))).toBe("sys-1");
  });
});

describe("previousRunId", () => {
  const runs = [
    run({ id: "new", run_at: "2026-10-08T00:00:00Z" }),
    run({ id: "mid", run_at: "2026-10-05T00:00:00Z" }),
    run({ id: "failed", run_at: "2026-10-04T00:00:00Z", status: "failed" }),
    run({ id: "other", run_at: "2026-10-03T00:00:00Z", metadata: { modules: [], file_name: "x", row_count: 0, system_id: "sys-2" } }),
    run({ id: "old", run_at: "2026-10-01T00:00:00Z" }),
  ];
  it("picks the latest complete earlier run in the same scope", () => {
    expect(previousRunId(runs[0], runs)).toBe("mid");
    expect(previousRunId(runs[1], runs)).toBe("old");
  });
  it("returns null when nothing is earlier", () => {
    expect(previousRunId(runs[4], runs)).toBeNull();
  });
});

describe("baselineRunId", () => {
  it("returns another pinned complete run in scope, never itself", () => {
    const base = run({ id: "base", metadata: { modules: [], file_name: "x", row_count: 0, system_id: "sys-1", baseline: true } });
    const cur = run({ id: "cur" });
    expect(baselineRunId(cur, [cur, base])).toBe("base");
    expect(baselineRunId(base, [cur, base])).toBeNull();
    expect(baselineRunId(cur, [cur])).toBeNull();
  });
});

describe("runSeries", () => {
  it("builds one ascending series per scope, newest scope first, capped", () => {
    const runs = [
      run({ id: "a2", run_at: "2026-10-08T00:00:00Z", dqs_summary: { m: dqs(80) } }),
      run({ id: "a1", run_at: "2026-10-01T00:00:00Z", dqs_summary: { m: dqs(70) } }),
      run({ id: "b1", run_at: "2026-10-02T00:00:00Z", dqs_summary: { m: dqs(60) }, metadata: null }),
      run({ id: "skip", run_at: "2026-10-09T00:00:00Z", status: "failed", dqs_summary: { m: dqs(1) } }),
      run({ id: "nodqs", run_at: "2026-10-09T00:00:00Z" }),
    ];
    expect(runSeries(runs)).toEqual([
      { scope: "sys-1", points: [{ x: "2026-10-01T00:00:00Z", y: 70 }, { x: "2026-10-08T00:00:00Z", y: 80 }] },
      { scope: "upload", points: [{ x: "2026-10-02T00:00:00Z", y: 60 }] },
    ]);
    expect(runSeries(runs, 1)).toHaveLength(1);
  });
});
