import { describe, expect, it } from "vitest";
import { cappedReads, cappedTables, type SplitScope } from "@/lib/api/v2/runs";
import { fixtureAction } from "@/lib/api/v2/fixtures/runs";

describe("cappedTables", () => {
  it("prefers the version's truncated_tables", () => {
    expect(cappedTables({ truncated_tables: ["MARA"] } as never)).toEqual(["MARA"]);
  });

  it("falls back to coverage for older runs", () => {
    const coverage = [
      { table: "MARA", status: "live", truncated: true },
      { table: "MARC", status: "live", truncated_slices: [{ plant: "1000" }] },
      { table: "MARD", status: "live" },
      { table: "MBEW", status: "failed", truncated: true },
    ];
    expect(cappedTables({ coverage } as never)).toEqual(["MARA", "MARC"]);
  });

  it("is empty without metadata", () => {
    expect(cappedTables(null)).toEqual([]);
    expect(cappedTables({} as never)).toEqual([]);
  });
});

describe("cappedReads", () => {
  it("pairs each capped table with its rows read and source total", () => {
    const coverage = [
      { table: "MARA", status: "live", truncated: true, rows: 1000, source_rows: 2500 },
      { table: "MARC", status: "live", truncated: true, rows: 1000 },
      { table: "MARD", status: "live", rows: 40 },
    ];
    expect(cappedReads({ coverage } as never)).toEqual([
      { table: "MARA", rows: 1000, source_rows: 2500 },
      { table: "MARC", rows: 1000, source_rows: null },
    ]);
  });

  it("names a capped table even without a coverage entry", () => {
    expect(cappedReads({ truncated_tables: ["MBEW"] } as never)).toEqual([{ table: "MBEW", rows: null, source_rows: null }]);
  });
});

describe("split-scope fixture", () => {
  it("previews smaller scopes without starting downloads", () => {
    const r = fixtureAction("split-scope", { systemId: "s", versionId: "v", start: false }) as SplitScope;
    expect(r.split_by).toBe("plants");
    expect(r.scopes.length).toBeGreaterThan(1);
    expect(r.downloads).toBeUndefined();
  });

  it("starts one download per scope", () => {
    const r = fixtureAction("split-scope", { systemId: "s", versionId: "v", start: true }) as SplitScope;
    expect(r.downloads).toHaveLength(r.scopes.length);
  });
});
