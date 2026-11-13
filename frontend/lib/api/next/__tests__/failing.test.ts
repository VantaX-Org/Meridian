import { describe, expect, it } from "vitest";
import { fixtureFailingRecords, RECORDS_PAGE } from "../failing";
import { loadParams } from "@/lib/api/v2/migration";

describe("failing records fixture", () => {
  it("pages and ends short", () => {
    const first = fixtureFailingRecords("v", "R1", RECORDS_PAGE, 0);
    expect(first.items).toHaveLength(RECORDS_PAGE);
    const last = fixtureFailingRecords("v", "R1", RECORDS_PAGE, first.total - 5);
    expect(last.items).toHaveLength(5);
    expect(first.items[0]).toMatchObject({ record_key: "MAT-000001", field: "MARA.MATKL" });
    expect(first.items.some((r) => r.expected_value === null)).toBe(true);
  });
});

describe("loadParams", () => {
  it("sends since only for incremental", () => {
    expect(loadParams({ load_mode: "full", since: "2026-01-01" })).toEqual({ load_mode: "full" });
    expect(loadParams({ load_mode: "incremental", since: "2026-01-01" })).toEqual({ load_mode: "incremental", since: "2026-01-01" });
  });
});
