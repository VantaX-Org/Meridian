import { describe, expect, it } from "vitest";
import { pickViz } from "../pickViz";

const base = { grounded: true, answer: "x", intent: "score", chart: "bar" as const };
const d = (...v: number[]) => v.map((value, i) => ({ label: `L${i}`, value }));

describe("pickViz", () => {
  it("none: ungrounded, empty, null, non-finite", () => {
    expect(pickViz({ ...base, grounded: false, data: d(1, 2, 3) }).kind).toBe("none");
    expect(pickViz({ ...base, answer: "", data: d(1, 2, 3) }).kind).toBe("none");
    expect(pickViz({ ...base, data: null }).kind).toBe("none");
    expect(pickViz({ ...base, data: [] }).kind).toBe("none");
    expect(pickViz({ ...base, data: d(NaN, Infinity) }).kind).toBe("none");
  });
  it("trend: line hint keeps order", () => {
    const v = pickViz({ ...base, chart: "line", data: d(3, 1, 2) });
    expect(v).toEqual({ kind: "trend", points: d(3, 1, 2) });
  });
  it("trend: dated bar series; one-point line is a stat", () => {
    const data = [{ label: "2026-01-01", value: 1 }, { label: "2026-02-01", value: 2 }, { label: "2026-03-01", value: 3 }];
    expect(pickViz({ ...base, data }).kind).toBe("trend");
    expect(pickViz({ ...base, chart: "line", data: d(5) }).kind).toBe("stat");
  });
  it("stack: monotone fixes funnel gives differences", () => {
    const v = pickViz({ ...base, intent: "fixes", data: d(10, 6, 1) });
    expect(v).toEqual({ kind: "stack", segs: [{ label: "L0", value: 4 }, { label: "L1", value: 5 }, { label: "L2", value: 1 }], total: { label: "L0", value: 10 } });
  });
  it("stack: non-monotone funnel falls through to ranked in emitted order", () => {
    const v = pickViz({ ...base, intent: "fixes", data: d(2, 9, 1) });
    expect(v).toMatchObject({ kind: "ranked", keepOrder: true, items: d(2, 9, 1) });
  });
  it("stat: one or two figures with delta", () => {
    expect(pickViz({ ...base, data: d(7) })).toMatchObject({ kind: "stat", delta: undefined });
    expect(pickViz({ ...base, data: d(7, 2) })).toMatchObject({ kind: "stat", delta: 5 });
  });
  it("ranked: sorts by magnitude, caps at 8, drops non-finite, handles negative and all-zero", () => {
    const v = pickViz({ ...base, data: d(1, -9, 3, 0, 2, 4, 5, 6, 7, NaN) });
    expect(v).toMatchObject({ kind: "ranked", keepOrder: false, more: 1 });
    if (v.kind === "ranked") { expect(v.items).toHaveLength(8); expect(v.items[0].value).toBe(-9); }
    expect(pickViz({ ...base, data: d(0, 0, 0) }).kind).toBe("ranked");
  });
});
