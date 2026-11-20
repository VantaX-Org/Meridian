import { describe, expect, it } from "vitest";
import { pickViz, sourcesOf } from "../pickViz";

const base = { grounded: true, intent: "score", chart: "bar" as const };
const d = (...v: number[]) => v.map((value, i) => ({ label: `L${i}`, value }));

describe("pickViz", () => {
  it("none when ungrounded, empty or non-finite", () => {
    expect(pickViz({ ...base, grounded: false, data: d(1, 2, 3) }).kind).toBe("none");
    expect(pickViz({ ...base, data: null }).kind).toBe("none");
    expect(pickViz({ ...base, data: d(NaN, Infinity) }).kind).toBe("none");
  });
  it("line for a line hint or a dated bar series; one point is a stat", () => {
    expect(pickViz({ ...base, chart: "line", data: d(3, 1, 2) })).toEqual({ kind: "line", points: d(3, 1, 2) });
    expect(pickViz({ ...base, data: [{ label: "2026-01-01", value: 1 }, { label: "2026-02-01", value: 2 }, { label: "2026-03-01", value: 3 }] }).kind).toBe("line");
    expect(pickViz({ ...base, chart: "line", data: d(5) }).kind).toBe("stat");
  });
  it("share: monotone fixes funnel gives differences, otherwise bars in emitted order", () => {
    expect(pickViz({ ...base, intent: "fixes", data: d(10, 6, 1) })).toEqual({ kind: "share", segs: [{ label: "L0", value: 4 }, { label: "L1", value: 5 }, { label: "L2", value: 1 }], total: 10 });
    expect(pickViz({ ...base, intent: "fixes", data: d(2, 9, 1) })).toEqual({ kind: "bars", items: d(2, 9, 1), more: 0 });
    expect(pickViz({ ...base, intent: "share", data: d(1, 3) })).toMatchObject({ kind: "share", total: 4 });
    expect(pickViz({ ...base, intent: "share", data: d(1, -3) }).kind).not.toBe("share");
  });
  it("stat delta, bars sorted by magnitude and capped at 8", () => {
    expect(pickViz({ ...base, data: d(7, 2) })).toMatchObject({ kind: "stat", delta: 5 });
    const v = pickViz({ ...base, data: d(1, -9, 3, 0, 2, 4, 5, 6, 7) });
    expect(v).toMatchObject({ kind: "bars", more: 1 });
    if (v.kind === "bars") expect(v.items[0].value).toBe(-9);
  });
});

describe("sourcesOf", () => {
  it("groups facts by source with distinct rule codes", () => {
    expect(sourcesOf([
      { source: "VBRK.NETWR", checks: [{ check_id: "C1" }] },
      { source: "VBRK.NETWR", checks: [{ check_id: "C1" }, { check_id: "C2" }] },
      { checks: [{ check_id: "C3" }] },
    ])).toEqual([{ source: "VBRK.NETWR", checks: ["C1", "C2"], n: 2 }]);
  });
});
