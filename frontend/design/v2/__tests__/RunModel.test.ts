import { describe, expect, it } from "vitest";
import type { CompareSummary, VersionHead } from "@/lib/api/v2/runs";
import { changeCounts, changeSentence, sameSystem } from "../screens/Compare";
import { groupRuns } from "../screens/Runs";

const run = (id: string, system_id: string | null, run_at: string) => ({ id, run_at, metadata: { system_id } }) as unknown as VersionHead;
const side = (raw_score: number) => ({ raw_score });
const summary = (pairs: [number | null, number | null][], newly_failing = 2, fixed = 5) =>
  ({
    objects: pairs.map(([b, a]) => ({ before: b == null ? null : side(b), after: a == null ? null : side(a) })),
    totals: { newly_failing, fixed },
  }) as unknown as CompareSummary;

describe("groupRuns", () => {
  const systems = [
    { id: "z", name: "Zeta", is_active: true },
    { id: "old", name: "Alpha", is_active: false },
    { id: "b", name: "Beta" },
  ];
  it("puts active systems first by name, inactive ones last and still present, newest run first", () => {
    const g = groupRuns([run("1", "z", "2026-01-01"), run("2", "old", "2026-03-01"), run("3", "z", "2026-02-01"), run("4", "b", "2026-01-01")], systems);
    expect(g.map((x) => x.name)).toEqual(["Beta", "Zeta", "Alpha"]);
    expect(g[1].rows.map((r) => r.id)).toEqual(["3", "1"]);
    expect(g[2].inactive).toBe(true);
  });
  it("keeps runs of a removed system and of no system in a named group", () => {
    const g = groupRuns([run("1", "gone", "2026-01-01"), run("2", null, "2026-01-01")], systems);
    expect(g.map((x) => x.name)).toEqual(["Unknown system", "Unknown system"]);
  });
});

describe("the compare guard", () => {
  it("refuses only two known systems that differ", () => {
    expect(sameSystem("a", "b")).toBe(false);
    expect(sameSystem("a", "a")).toBe(true);
    expect(sameSystem(null, "b")).toBe(true);
    expect(sameSystem("a", undefined)).toBe(true);
  });
});

describe("the change sentence", () => {
  it("counts measured scores, leaves out flat and unmeasured objects, and says the rule counts", () => {
    const S = summary([[70, 72], [80, 79], [60, 60], [null, 50]]);
    expect(changeCounts(S)).toEqual({ up: 1, dn: 1 });
    expect(changeSentence(S)).toBe("1 object scored higher and 1 lower. 2 rules started failing and 5 stopped.");
  });
  it("uses the plural", () => {
    expect(changeSentence(summary([[1, 2], [3, 4]], 0, 0))).toBe("2 objects scored higher and 0 lower. 0 rules started failing and 0 stopped.");
  });
});
