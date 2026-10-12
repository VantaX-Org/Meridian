import { describe, expect, it } from "vitest";
import { bottleneckKeys, isRework } from "../_components/edge-marks";

const e = (source: string, target: string, median_seconds: number | null) => ({ source, target, count: 1, median_seconds });

describe("edge marks", () => {
  it("marks the top decile by median wait and ignores missing waits", () => {
    const edges = Array.from({ length: 10 }, (_, i) => e(`a${i}`, `b${i}`, i + 1));
    expect([...bottleneckKeys(edges)]).toEqual(["a9>b9"]);
    expect(bottleneckKeys([e("START", "a", null), e("a", "b", null)]).size).toBe(0);
  });
  it("flags rework from model order only", () => {
    const order = (id: string) => ({ a: 1, b: 2 })[id as "a" | "b"];
    expect(isRework(e("b", "a", 1), order)).toBe(true);
    expect(isRework(e("a", "b", 1), order)).toBe(false);
    expect(isRework(e("a", "a", 1), order)).toBe(true);
    expect(isRework(e("START", "a", null), order)).toBe(false);
    expect(isRework(e("b", "zz", 1), order)).toBe(false);
  });
});
