import { describe, expect, it } from "vitest";
import { cappedTables } from "@/lib/api/v2/runs";

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
