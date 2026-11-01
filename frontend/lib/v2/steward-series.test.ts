import { describe, expect, it } from "vitest";
import { stewardSeries } from "./people";
import { stewardFixture } from "@/lib/api/v2/fixtures/approvals";

describe("stewardSeries", () => {
  it("orders periods oldest first and gives a rate only where something was decided", () => {
    const p = (period: string, a: number, r: number) => ({ period, items_processed: a + r, items_approved: a, items_rejected: r, items_applied: a, total_review_hours: 1, exceptions_resolved: 0, dqs_impact: null });
    expect(stewardSeries([p("2026-10", 9, 1), p("2026-09", 0, 0)])).toEqual([
      { period: "2026-09", processed: 0, rate: null },
      { period: "2026-10", processed: 10, rate: 90 },
    ]);
  });

  it("the fixture answers a steward with work and a 404 for a person with none", () => {
    expect(stewardFixture("u-an").periods).toHaveLength(6);
    expect(() => stewardFixture("u-sd")).toThrow("No metrics found");
  });
});
