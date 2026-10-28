import { describe, expect, it } from "vitest";
import type { Version, DQSSummary } from "@/types/api";
import { baselineRunId, FINISHED, isFinished, overallDqs, previousRunId, runPageHref, runSeries, scopeOf } from "../runs";

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
  it("never offers another uploaded object as the previous run", () => {
    const upload = (id: string, at: string, modules: string[]): Version =>
      run({ id, run_at: at, metadata: { modules, file_name: "f.csv", row_count: 1 } });
    const uploads = [
      upload("co2", "2026-10-09T00:00:00Z", ["controlling"]),
      upload("co1", "2026-10-07T00:00:00Z", ["controlling"]),
      upload("bp", "2026-10-06T00:00:00Z", ["business_partner"]),
    ];
    expect(previousRunId(uploads[0], uploads)).toBe("co1");
    expect(previousRunId(uploads[1], uploads)).toBeNull(); // the first controlling upload: bp is another object
  });
  it("counts every finished status, not only complete (agents and enrichment run after scoring)", () => {
    const finished = [
      run({ id: "new", run_at: "2026-10-08T00:00:00Z", status: "agents_complete" }),
      run({ id: "enriched", run_at: "2026-10-07T00:00:00Z", status: "ai_enriched" }),
      run({ id: "agents-failed", run_at: "2026-10-06T00:00:00Z", status: "agents_failed" }),
      run({ id: "partial", run_at: "2026-10-05T00:00:00Z", status: "partial" }),
      run({ id: "running", run_at: "2026-10-04T00:00:00Z", status: "running" }),
    ];
    expect(previousRunId(finished[0], finished)).toBe("enriched");
    expect(previousRunId(finished[1], finished)).toBe("agents-failed");
    expect(previousRunId(finished[2], finished)).toBe("partial");
    expect(previousRunId(finished[3], finished)).toBeNull();
  });
});

describe("FINISHED", () => {
  it("is the one finished-run set: scored runs whatever happened after scoring", () => {
    for (const s of ["complete", "agents_complete", "ai_enriched", "agents_failed", "partial"]) expect(isFinished({ status: s as Version["status"] })).toBe(true);
    for (const s of ["pending", "running", "failed", "agents_running", "agents_enqueued"]) expect(isFinished({ status: s as Version["status"] })).toBe(false);
    expect(FINISHED.size).toBe(5);
  });
});

describe("runPageHref", () => {
  it("names the run itself as the ?run= scope, so a stale scope never rides along", () => {
    expect(runPageHref("abc")).toBe("/runs/abc?run=abc");
    expect(runPageHref("abc", { module: "fi_gl", tab: undefined })).toBe("/runs/abc?run=abc&module=fi_gl");
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

import { labelFamily, lineageOf, previousInLineage, sameLineage } from "../runs";

describe("lineage", () => {
  it("labelFamily strips a size or count suffix from an upload label", () => {
    expect(labelFamily("business_partner_100k")).toBe("business_partner");
    expect(labelFamily("Vendors 25k records")).toBe("vendors");
    expect(labelFamily("controlling_1k")).toBe("controlling");
    expect(labelFamily("ERP-SIM vendors")).toBe("erp-sim vendors");
    expect(labelFamily(null)).toBe("");
  });

  it("runs of one system share a lineage whatever their objects", () => {
    const a = run({ id: "a", metadata: { modules: ["material_master"], file_name: "f", row_count: 1, system_id: "sys-1" } });
    const b = run({ id: "b", metadata: { modules: ["fi_gl"], file_name: "g", row_count: 1, system_id: "sys-1" } });
    const c = run({ id: "c", metadata: { modules: ["fi_gl"], file_name: "g", row_count: 1, system_id: "sys-2" } });
    expect(lineageOf(a)).toBe(lineageOf(b));
    expect(lineageOf(a)).not.toBe(lineageOf(c));
  });

  it("uploads share a lineage only when they carry the same objects", () => {
    const bp1 = run({ id: "bp1", label: "business_partner_1k", metadata: { modules: ["business_partner"], file_name: "f", row_count: 1 } });
    const bp2 = run({ id: "bp2", label: "business_partner_100k", metadata: { modules: ["business_partner"], file_name: "f", row_count: 1 } });
    const co = run({ id: "co", label: "controlling_1k", metadata: { modules: ["controlling"], file_name: "f", row_count: 1 } });
    const sys = run({ id: "sys", metadata: { modules: ["business_partner"], file_name: "f", row_count: 1, system_id: "sys-1" } });
    expect(lineageOf(bp1)).toBe(lineageOf(bp2));
    expect(lineageOf(bp1)).not.toBe(lineageOf(co));
    expect(lineageOf(bp1)).not.toBe(lineageOf(sys));
  });

  it("falls back to the scored modules, then the label family, for uploads without module metadata", () => {
    const scored = run({ id: "s", metadata: { modules: [], file_name: "f", row_count: 1 }, dqs_summary: { fi_gl: dqs(70) } });
    const scored2 = run({ id: "s2", metadata: { modules: [], file_name: "f", row_count: 1 }, dqs_summary: { fi_gl: dqs(80) } });
    expect(lineageOf(scored)).toBe(lineageOf(scored2));
    const byLabel = run({ id: "l", label: "hcm_1k", metadata: { modules: [], file_name: "f", row_count: 1 } });
    const byLabel2 = run({ id: "l2", label: "hcm_25k", metadata: { modules: [], file_name: "f", row_count: 1 } });
    expect(lineageOf(byLabel)).toBe("upload:hcm");
    expect(lineageOf(byLabel)).toBe(lineageOf(byLabel2));
  });

  it("previousInLineage is the newest earlier run of the same lineage, or null for the first run", () => {
    const mk = (id: string, at: string, modules: string[]) => run({ id, run_at: at, metadata: { modules, file_name: "f", row_count: 1 } });
    const bpOld = mk("bp-old", "2026-10-01T00:00:00Z", ["business_partner"]);
    const bpMid = mk("bp-mid", "2026-10-05T00:00:00Z", ["business_partner"]);
    const co = mk("co", "2026-10-06T00:00:00Z", ["controlling"]);
    const bpNew = mk("bp-new", "2026-10-08T00:00:00Z", ["business_partner"]);
    const all = [bpNew, co, bpMid, bpOld];
    expect(previousInLineage(bpNew, all)?.id).toBe("bp-mid");
    expect(previousInLineage(bpOld, all)).toBeNull();
    // Another object's run is never the previous run, however recent.
    expect(previousInLineage(co, all)).toBeNull();
    expect(sameLineage(bpNew, all).map((r) => r.id)).toEqual(["bp-new", "bp-mid", "bp-old"]);
  });
});
