import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";

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
