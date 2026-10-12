import { describe, expect, it } from "vitest";
import { l1Label, largestCost, largestValueAtRisk, valueAtRiskByL1, type ImpactRow } from "../insights";

const row = (feature: string, l1: string | null, value_at_risk: number): ImpactRow =>
  ({ feature, l1, status: "blocked", record_count: 1, value_per_record: value_at_risk, value_at_risk, causing_rules: [] });

describe("largestValueAtRisk", () => {
  it("returns null for no L1s", () => {
    expect(largestValueAtRisk([])).toBeNull();
  });

  it("picks the largest L1 and counts processes, never a sum", () => {
    const top = largestValueAtRisk([
      { l1: "procure_to_pay", value_at_risk: 100 },
      { l1: "order_to_cash", value_at_risk: 120 },
    ]);
    expect(top).toEqual({ l1: "order_to_cash", value_at_risk: 120, processes: 2 });
  });
});

describe("largestCost", () => {
  it("picks the largest L1 amount", () => {
    expect(largestCost([{ l1: "a", amount: 1 }, { l1: "b", amount: 5 }])).toEqual({ l1: "b", amount: 5, processes: 2 });
    expect(largestCost([])).toBeNull();
  });
});

describe("valueAtRiskByL1", () => {
  it("sums within an L1 only and groups missing L1 as unassigned", () => {
    const out = valueAtRiskByL1([row("a", "procure_to_pay", 10), row("b", "procure_to_pay", 5), row("c", "order_to_cash", 7), row("d", null, 2)]);
    expect(out).toEqual([
      { l1: "procure_to_pay", value_at_risk: 15 },
      { l1: "order_to_cash", value_at_risk: 7 },
      { l1: "unassigned", value_at_risk: 2 },
    ]);
  });
});

describe("l1Label", () => {
  it("maps known keys and spaces unknown ones", () => {
    expect(l1Label("procure_to_pay")).toBe("Procure to pay");
    expect(l1Label("some_new_l1")).toBe("Some new l1");
  });
});
