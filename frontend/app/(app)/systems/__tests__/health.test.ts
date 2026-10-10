import { describe, it, expect } from "vitest";
import type { SystemVersion } from "@/lib/api/system-objects";
import type { SyncProfile } from "@/types/api";
import { dqsTrend, latestDqs, nextRun } from "../_health";

const version = (run_at: string, dqs: Record<string, number | null>, analysed = true): SystemVersion => ({
  id: run_at, run_at, label: null, status: "complete", objects: [], scope: {}, records: {},
  analysed_at: analysed ? run_at : null, rule_set: null, baseline: false, analysable: true, dqs, field_status: [],
  extraction_complete: true, coverage: { read: 0, issues: [] }, outliers: {},
});
const profile = (next_run_at: string | null, active = true): SyncProfile => ({
  id: next_run_at ?? "none", system_id: "s1", domain: "fi_gl", tables: [], schedule_cron: "0 2 * * *",
  active, last_run_at: null, next_run_at, extraction_mode: "full",
});

describe("systems list helpers", () => {
  it("dqsTrend compares the two newest analysed runs", () => {
    const vs = [version("2026-10-01", { a: 80, b: 90 }), version("2026-10-08", { a: 70, b: 80 }),
                version("2026-10-09", { a: 99 }, false)];
    expect(dqsTrend(vs)).toBe(-10);
    expect(latestDqs(vs).dqs).toBe(75);
    expect(dqsTrend([version("2026-10-01", { a: 80 })])).toBeNull();
    expect(dqsTrend([version("2026-10-01", { a: 80 }), version("2026-10-02", { a: null })])).toBeNull();
  });

  it("nextRun picks the earliest active schedule", () => {
    expect(nextRun([profile("2026-10-11T02:00:00+02:00"), profile("2026-10-10T23:00:00Z"),
                    profile("2026-10-10T01:00:00Z", false), profile(null)])).toBe("2026-10-10T23:00:00Z");
    expect(nextRun([profile(null)])).toBeNull();
  });
});
