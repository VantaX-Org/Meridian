import { describe, expect, it } from "vitest";
import { fitCountDomain } from "@/design/charts/Line";
import { impactOf, rankFixFirst } from "../fix-first";

type Row = { id: string; severity: string | null; records: number; cost?: number | null };
const pick = (r: Row) => ({ severity: r.severity, records: r.records, cost: r.cost });

describe("rankFixFirst", () => {
  it("ranks by failing records times severity weight and leaves low severity out", () => {
    const rows: Row[] = [
      { id: "low-big", severity: "low", records: 9000 },
      { id: "high", severity: "high", records: 30 },
      { id: "crit", severity: "critical", records: 20 },
      { id: "med", severity: "medium", records: 90 },
    ];
    expect(rankFixFirst(rows, pick, 10).map((r) => r.id)).toEqual(["crit", "med", "high"]);
    expect(impactOf({ severity: "HIGH", records: 3, cost: null })).toBe(15);
  });

  it("breaks a tie on cost at risk, then records, and keeps at most the limit", () => {
    const rows: Row[] = [
      { id: "a", severity: "high", records: 10, cost: 100 },
      { id: "b", severity: "critical", records: 5, cost: 900 },
      { id: "c", severity: "medium", records: 25 },
    ];
    expect(rankFixFirst(rows, pick, 2).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("fitCountDomain", () => {
  it("fits a count that moves little to the data, on round steps", () => {
    expect(fitCountDomain([2610, 2575, 2540])).toEqual([2540, 2620]);
  });

  it("keeps a target inside the window and never goes below zero", () => {
    expect(fitCountDomain([40, 30, 20], 0)).toEqual([0, 40]);
    expect(fitCountDomain([5, 5])[0]).toBeGreaterThanOrEqual(0);
    expect(fitCountDomain([])).toEqual([0, 1]);
  });
});
