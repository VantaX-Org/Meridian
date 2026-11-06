import { describe, expect, it } from "vitest";
import type { Timeline } from "@/lib/api/v2/runs";
import { valueRibbons } from "./value-ribbon";

const o = (amount: number | null) => ({ score: 90, raw_score: 90, capped: false, value_at_risk: amount === null ? null : { amount, currency: "ZAR" } });
const run = (id: string, objects: Record<string, ReturnType<typeof o>>) => ({ id, run_at: null, label: null, system_id: null, baseline: false, kind: "manual", objects, records_checked: null, duration_s: null });

describe("valueRibbons", () => {
  it("builds one series per priced object, biggest latest first, skipping unpriced objects", () => {
    const tl: Timeline = { system_id: null, limit: 3, runs: [run("a", { mat: o(10), cus: o(null) }), run("b", { mat: o(null), cus: o(null) }), run("c", { mat: o(30) , cus: o(null) })] };
    const r = valueRibbons(tl);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ object: "mat", series: [10, null, 30], latest: 30, currency: "ZAR" });
  });
  it("is empty with no runs", () => {
    expect(valueRibbons({ system_id: null, limit: 3, runs: [] })).toEqual([]);
  });
});
