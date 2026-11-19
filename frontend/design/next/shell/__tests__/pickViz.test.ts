import { describe, expect, it } from "vitest";
import { pickRail, pickViz } from "../pickViz";

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
  it("line: line hint keeps order", () => {
    const v = pickViz({ ...base, chart: "line", data: d(3, 1, 2) });
    expect(v).toEqual({ kind: "line", points: d(3, 1, 2), nowIndex: 2 });
  });
  it("line: dated bar series; one-point line is a stat", () => {
    const data = [{ label: "2026-01-01", value: 1 }, { label: "2026-02-01", value: 2 }, { label: "2026-03-01", value: 3 }];
    expect(pickViz({ ...base, data }).kind).toBe("line");
    expect(pickViz({ ...base, chart: "line", data: d(5) }).kind).toBe("stat");
  });
  it("share: monotone fixes funnel gives differences", () => {
    const v = pickViz({ ...base, intent: "fixes", data: d(10, 6, 1) });
    expect(v).toEqual({ kind: "share", segs: [{ label: "L0", value: 4 }, { label: "L1", value: 5 }, { label: "L2", value: 1 }], total: 10 });
  });
  it("share: non-monotone funnel falls through to ranked in emitted order", () => {
    const v = pickViz({ ...base, intent: "fixes", data: d(2, 9, 1) });
    expect(v).toMatchObject({ kind: "bars", keepOrder: true, items: d(2, 9, 1) });
  });
  it("stat: one or two figures with delta", () => {
    expect(pickViz({ ...base, data: d(7) })).toMatchObject({ kind: "stat", delta: undefined });
    expect(pickViz({ ...base, data: d(7, 2) })).toMatchObject({ kind: "stat", delta: 5 });
  });
  it("bars: sorts by magnitude, caps at 8, drops non-finite, handles negative and all-zero", () => {
    const v = pickViz({ ...base, data: d(1, -9, 3, 0, 2, 4, 5, 6, 7, NaN) });
    expect(v).toMatchObject({ kind: "bars", keepOrder: false, more: 1 });
    if (v.kind === "bars") { expect(v.items).toHaveLength(8); expect(v.items[0].value).toBe(-9); }
    expect(pickViz({ ...base, data: d(0, 0, 0) }).kind).toBe("bars");
  });
});

describe("pickRail", () => {
  const A = { ...base, links: [], phrased: false, facts: [{ statement: "s", value: 1, source: "VBRK.NETWR", checks: [{ check_id: "C1" }] }, { statement: "t", value: 2, source: "VBRK.NETWR", checks: [{ check_id: "C2" }] }], coverage: 0.9, citations: [] };
  const kinds = (v: { kind: string }[]) => v.map((x) => x.kind);
  it("ungrounded or empty gives []", () => {
    expect(pickRail({ ...A, grounded: false, data: d(1, 2, 3) }, ["q"])).toEqual([]);
    expect(pickRail({ ...A, answer: " " }, ["q"])).toEqual([]);
  });
  it("compare needs exactly one naive and one true", () => {
    const both = [{ label: "N", value: -38, role: "naive" as const }, { label: "T", value: -2.2, role: "true" as const }];
    expect(pickRail({ ...A, data: both }, [])[0]).toEqual({ kind: "compare", naive: both[0], truth: both[1] });
    expect(kinds(pickRail({ ...A, data: [both[0], { label: "x", value: 1 }, { label: "y", value: 2 }] }, []))).not.toContain("compare");
  });
  it("pace only when pace_pct is finite; compare wins slot 1", () => {
    expect(pickRail({ ...A, data: null, pace_pct: 96 }, [])[0]).toEqual({ kind: "pace", pct: 96, coverage: 0.9 });
    expect(kinds(pickRail({ ...A, data: null, pace_pct: NaN }, []))).not.toContain("pace");
  });
  it("lead kinds: line, bars, share, stat", () => {
    expect(pickRail({ ...A, chart: "line", data: d(1, 2) }, [])[0].kind).toBe("line");
    expect(pickRail({ ...A, data: d(1, 5, 3) }, [])[0].kind).toBe("bars");
    expect(pickRail({ ...A, intent: "share", data: d(1, 3) }, [])[0]).toMatchObject({ kind: "share", total: 4 });
    expect(pickRail({ ...A, intent: "share", data: d(1, -3) }, [])[0].kind).not.toBe("share");
    expect(pickRail({ ...A, data: d(7) }, [])[0].kind).toBe("stat");
  });
  it("source groups by source; findings from suggestions; ledger only with finite value_found", () => {
    const r = pickRail({ ...A, data: null, value_found: 12 }, ["a", "b", "c", "d", "e"]);
    expect(r).toEqual([
      { kind: "source", rows: [{ source: "VBRK.NETWR", checks: ["C1", "C2"], n: 2 }] },
      { kind: "findings", items: ["a", "b", "c", "d"] },
      { kind: "ledger", value: 12, unit: "" },
    ]);
    expect(kinds(pickRail({ ...A, data: null, facts: [], value_found: NaN }, []))).toEqual([]);
  });
  it("max 4 and never map", () => {
    const r = pickRail({ ...A, data: d(7), pace_pct: 90, value_found: 1 }, ["q"]);
    expect(r).toHaveLength(4);
    expect(kinds(r)).not.toContain("map");
    expect(kinds(r)).not.toContain("none");
  });
});
