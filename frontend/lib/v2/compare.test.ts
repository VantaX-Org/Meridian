import { describe, expect, it } from "vitest";
import { keyParts, shortfall, trendSeries } from "./compare";

describe("system comparison helpers", () => {
  it("splits a compound record key", () => {
    expect(keyParts("MATNR=100|WERKS=1000")).toEqual([{ field: "MATNR", value: "100" }, { field: "WERKS", value: "1000" }]);
    expect(keyParts("X=a=b")).toEqual([{ field: "X", value: "a=b" }]);
  });
  it("orders the trend oldest first, one series per score", () => {
    const p = (at: string, v: number | null) => ({ comparison_id: at, at, source: v, projected: v, actual: null, missing_in_target: null, differing_fields: null });
    expect(trendSeries([p("2026-11-10", 2), p("2026-11-03", 1)])).toEqual({ source: [1, 2], projected: [1, 2], actual: [null, null] });
  });
  it("measures the shortfall of the target against the projection", () => {
    expect(shortfall(86.1, 83.7)).toBe(2.4);
    expect(shortfall(86.1, null)).toBeNull();
  });
});
