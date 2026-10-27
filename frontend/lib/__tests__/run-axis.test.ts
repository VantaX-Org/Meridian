import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { compareTimes, runAxisTicks, runOptionLabels } from "@/lib/run-axis";

const run = (id: string, run_at: string) => ({ id, run_at });

describe("runAxisTicks", () => {
  it("uses the date for every tick when each run has a day of its own", () => {
    const runs = [run("a", "2026-10-02T05:08:00Z"), run("b", "2026-10-16T03:04:00Z")];
    const t = runAxisTicks(runs);
    expect(t.get("a")).toBe(formatDate(runs[0].run_at, "date"));
    expect(t.get("b")).toBe(formatDate(runs[1].run_at, "date"));
  });

  it("puts every tick in one format: seconds for all when any two runs share a minute", () => {
    const runs = [run("a", "2026-10-02T05:08:00Z"), run("b", "2026-10-16T03:01:18Z"), run("c", "2026-10-16T03:01:39Z"), run("d", "2026-10-16T03:04:00Z")];
    const t = runAxisTicks(runs);
    for (const r of runs) expect(t.get(r.id)).toBe(formatDate(r.run_at, "seconds"));
    // never "16 Oct, 03:04" beside "16 Oct, 03:01:18"
    expect(new Set([...t.values()].map((v) => v.split(":").length)).size).toBe(1);
  });

  it("minutes for all when the minute tells every run apart", () => {
    const runs = [run("a", "2026-10-16T03:01:00Z"), run("b", "2026-10-16T03:04:00Z"), run("c", "2026-10-17T03:04:00Z")];
    const t = runAxisTicks(runs);
    for (const r of runs) expect(t.get(r.id)).toBe(formatDate(r.run_at, "datetime"));
  });

  it("numbers runs that share even the second, in run order", () => {
    const t = runAxisTicks([run("b", "2026-10-16T03:01:18Z"), run("a", "2026-10-16T03:01:18Z")]);
    expect(new Set(t.values()).size).toBe(2);
    expect([...t.values()].every((v) => / #[12]$/.test(v))).toBe(true);
  });
});

describe("runOptionLabels", () => {
  it("keeps a unique label, and tells runs that share a label apart in one date format", () => {
    const labels = runOptionLabels([
      { id: "a", label: "controlling_1k", run_at: "2026-10-16T05:17:01Z" },
      { id: "b", label: "controlling_1k", run_at: "2026-10-16T05:17:02Z" },
      { id: "c", label: "controlling_1k", run_at: "2026-10-15T08:00:00Z" },
      { id: "d", label: "fi_gl_1k", run_at: "2026-10-16T05:17:01Z" },
      { id: "e", label: null, run_at: "2026-10-14T10:00:00Z" },
    ]);
    expect(labels.get("a")).toBe("controlling_1k, 16 Oct 2026, 05:17:01");
    expect(labels.get("b")).toBe("controlling_1k, 16 Oct 2026, 05:17:02");
    expect(labels.get("c")).toBe("controlling_1k, 15 Oct 2026, 08:00:00");
    expect(labels.get("d")).toBe("fi_gl_1k");
    expect(labels.get("e")).toBe("14 Oct 2026, 10:00");
  });
});

describe("compareTimes", () => {
  it("adds seconds only when both runs share the minute", () => {
    const [a, b] = compareTimes("2026-10-16T03:01:12Z", "2026-10-16T03:01:48Z");
    expect(a).toBe(formatDate("2026-10-16T03:01:12Z", "seconds"));
    expect(b).toBe(formatDate("2026-10-16T03:01:48Z", "seconds"));
    expect(a).not.toBe(b);
    expect(compareTimes("2026-10-16T03:01:12Z", "2026-10-16T03:04:00Z")).toEqual([formatDate("2026-10-16T03:01:12Z", "datetime"), formatDate("2026-10-16T03:04:00Z", "datetime")]);
  });
});
