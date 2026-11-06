import { describe, expect, it } from "vitest";
import { pairQuality } from "./paired-quality";

const r = (check_id: string, change: number) => ({ check_id, description: null, severity: "high", dimension: "validity", source_pass_rate: 90, target_pass_rate: 90 + change, change });

describe("pairQuality", () => {
  it("orders reasons by size of change and computes the move only when both scores exist", () => {
    const [a, b] = pairQuality([
      { module: "material_master", source: 60, projected: 70, actual: 66.5, actual_reason: null, reasons: [r("A", 1), r("B", -9), r("C", 4), r("D", 0.5)] },
      { module: "sd_customer_master", source: 55, projected: 62, actual: null, actual_reason: "no_target_analysis", reasons: [] },
    ]);
    expect(a.reasons.map((x) => x.check_id)).toEqual(["B", "C", "A"]);
    expect(a.moved).toBe(6.5);
    expect(b.moved).toBeNull();
    expect(b.actualReason).toBe("no_target_analysis");
  });
});
