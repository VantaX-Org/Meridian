import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { ObjectsMonitor, baselineText, cadenceText, triggerText } from "../screens/ObjectMonitors";
import type { ObjectMonitor } from "@/lib/api/v2/run-ops";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const base: ObjectMonitor = {
  module: "material_master",
  system_id: null,
  last_run_at: null,
  last_version_id: null,
  trigger: null,
  requested_by_label: null,
  cadence: { cron: null, active: null, interval_seconds: null, profile_id: null },
  next_run_at: null,
  freshness: "manual",
  baseline: { kind: null, version_id: null, run_at: null },
  drift: { new_failing: 0, recovered: 0, newly_failing_rules: [], recovered_rules: [], newly_failing_rule_count: 0, recovered_rule_count: 0 },
};

describe("monitor words", () => {
  it("gives a dash-able null for what the API did not record", () => {
    expect(cadenceText(base)).toBeNull();
    expect(triggerText(base)).toBeNull();
    expect(baselineText(base)).toBeNull();
  });

  it("says the cadence, the pause and the trigger in words", () => {
    expect(cadenceText({ ...base, cadence: { ...base.cadence, cron: "0 2 * * *" } })).toContain("02:00");
    expect(cadenceText({ ...base, cadence: { ...base.cadence, cron: "0 2 * * *", active: false } })).toContain("paused");
    expect(cadenceText({ ...base, cadence: { ...base.cadence, interval_seconds: 3600 } })).toContain("Every");
    expect(triggerText({ ...base, trigger: "scheduled" })).toBe("Scheduled");
    expect(baselineText({ ...base, baseline: { kind: "pinned", version_id: "v", run_at: null } })).toBe("Pinned run");
  });
});

describe("Objects monitor", () => {
  it("draws a row per measured object with its freshness word", async () => {
    renderWithQuery(<ObjectsMonitor />);
    const table = await screen.findByTestId("objects-monitor-table");
    const rows = within(table).getAllByTestId("objects-monitor-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.getAttribute("data-freshness")).toMatch(/^(fresh|due|stale|failed|paused|manual)$/);
  });
});
