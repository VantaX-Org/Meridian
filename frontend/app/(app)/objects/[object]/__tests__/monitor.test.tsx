// frontend/app/(app)/objects/[object]/__tests__/monitor.test.tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as triageApi from "@/lib/api/triage";
import { fixHref } from "@/lib/drill";
import { ObjectMonitorStrip } from "../_monitor";

const granted = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => granted.set.has(a) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/objects/material_master" }));

const RECENT = new Date(Date.now() - 3 * 3_600_000).toISOString();

function monitor(over: Partial<objectsApi.ObjectMonitor> = {}): objectsApi.ObjectMonitor {
  return {
    module: "material_master",
    system_id: "sys-1",
    last_run_at: RECENT,
    last_version_id: "v2",
    trigger: "scheduled",
    requested_by_label: null,
    cadence: { cron: "0 2 * * *", active: true, interval_seconds: 86_400, profile_id: "p1" },
    next_run_at: "2027-01-02T00:00:00Z",
    freshness: "fresh",
    baseline: { kind: "pinned", version_id: "v1", run_at: "2026-10-12T00:00:00Z" },
    drift: {
      new_failing: 14, recovered: 5,
      newly_failing_rules: [{ check_id: "MM_001", severity: "high", new: 14 }],
      recovered_rules: [{ check_id: "MM_002" }],
      newly_failing_rule_count: 1, recovered_rule_count: 1,
    },
    ...over,
  };
}

const show = (m: objectsApi.ObjectMonitor | null) => {
  vi.spyOn(objectsApi, "getObjectMonitor").mockResolvedValue(m);
  return renderWithQuery(<ObjectMonitorStrip object="material_master" run="v2" />);
};
const strip = async () => within(await screen.findByTestId("object-monitor"));

beforeEach(() => {
  vi.restoreAllMocks();
  granted.set = new Set();
  vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({
    timezone: "Africa/Johannesburg", work_days: [1, 2, 3, 4, 5], work_start: "08:00", work_end: "17:00", holidays: [], fallback_user_id: null,
  });
});

describe("ObjectMonitorStrip", () => {
  it.each([
    ["fresh", "Fresh"], ["due", "Due"], ["stale", "Stale"], ["failed", "Failed"], ["paused", "Paused"], ["manual", "Manual"],
  ] as const)("shows the %s freshness state as %s", async (freshness, label) => {
    show(monitor({ freshness }));
    expect(await (await strip()).findByText(label, { selector: ".m-pill" })).toBeInTheDocument();
  });

  it("reads the checked time, who started it, the cadence, the next check and the pinned baseline", async () => {
    show(monitor());
    const s = await strip();
    expect(await s.findByText("3h ago")).toBeInTheDocument();
    expect(s.getByText("Started by the schedule")).toBeInTheDocument();
    expect(s.getByText("Daily at 02:00")).toBeInTheDocument();
    expect(s.getByText(/^Pinned run of /)).toBeInTheDocument();
    expect(s.getByText("2 Jan 2027, 02:00 GMT+2")).toBeInTheDocument();
  });

  it("names the person who started a manual run or a re-check", async () => {
    show(monitor({ trigger: "recheck", requested_by_label: "Jane Doe" }));
    expect(await (await strip()).findByText("Re-check by Jane Doe")).toBeInTheDocument();
  });

  it("says Manual only and Paused for those cadences", async () => {
    const view = show(monitor({ freshness: "manual", cadence: { cron: null, active: null, interval_seconds: null, profile_id: null }, next_run_at: null }));
    expect(await (await strip()).findByText("Manual only")).toBeInTheDocument();
    view.unmount();
    show(monitor({ freshness: "paused", cadence: { cron: "0 2 * * *", active: false, interval_seconds: 86_400, profile_id: "p1" }, next_run_at: null }));
    expect(await (await strip()).findAllByText("Paused")).toHaveLength(2); // the cadence and the pill
  });

  it("says Not checked yet for an object that never ran", async () => {
    show(monitor({ last_run_at: null, last_version_id: null, trigger: null, freshness: "due", baseline: { kind: null, version_id: null, run_at: null } }));
    const s = await strip();
    expect(await s.findByText("Not checked yet")).toBeInTheDocument();
    expect(s.getByText("No run yet")).toBeInTheDocument();
  });

  it("reads First run with no deltas for an object with one run", async () => {
    show(monitor({ baseline: { kind: null, version_id: null, run_at: null }, drift: { new_failing: 0, recovered: 0, newly_failing_rules: [], recovered_rules: [], newly_failing_rule_count: 0, recovered_rule_count: 0 } }));
    const s = await strip();
    expect(await s.findByText("First run")).toBeInTheDocument();
    expect(s.getByText("None yet")).toBeInTheDocument();
    expect(s.queryByText("Newly failing rules")).toBeNull();
    expect(s.queryByText("Recovered rules")).toBeNull();
  });

  it("labels an automatic baseline as the previous run", async () => {
    show(monitor({ baseline: { kind: "previous", version_id: "v1", run_at: "2026-10-12T00:00:00Z" } }));
    expect(await (await strip()).findByText("Previous run")).toBeInTheDocument();
  });

  describe("drill contract", () => {
    it("opens exactly the new failing records of the one newly failing rule, and the compare page for recovered", async () => {
      show(monitor());
      const s = await strip();
      const newRecords = await s.findByRole("link", { name: "Open the 14 new failing records of Material master" });
      expect(newRecords).toHaveAttribute("href", fixHref({ run: "v2", module: "material_master", check: "MM_001" }));
      expect(newRecords).toHaveAttribute("href", "/fix?run=v2&module=material_master&check=MM_001");
      const recovered = s.getByRole("link", { name: /5 recovered records/ });
      expect(recovered).toHaveAttribute("href", "/runs/v2/vs/v1");
    });

    it("leaves the rule off the fix link when several rules newly fail", async () => {
      show(monitor({ drift: { ...monitor().drift, newly_failing_rule_count: 3, newly_failing_rules: [{ check_id: "MM_001" }, { check_id: "MM_003" }, { check_id: "MM_004" }] } }));
      const link = await (await strip()).findByRole("link", { name: "Open the 14 new failing records of Material master" });
      expect(link).toHaveAttribute("href", "/fix?run=v2&module=material_master");
    });

    it("links no zero count", async () => {
      show(monitor({ drift: { new_failing: 0, recovered: 0, newly_failing_rules: [], recovered_rules: [], newly_failing_rule_count: 0, recovered_rule_count: 0 } }));
      const s = await strip();
      await s.findByText("0 new failing records");
      expect(s.queryByRole("link", { name: /new failing records/ })).toBeNull();
      expect(s.queryByRole("link", { name: /recovered record/ })).toBeNull();
    });
  });

  describe("actions", () => {
    it("disables Re-check now without trigger_sync", async () => {
      const recheck = vi.spyOn(objectsApi, "recheckObject");
      show(monitor());
      const button = await screen.findByRole("button", { name: /^Re-check now/ });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(recheck).not.toHaveBeenCalled();
    });

    it("re-checks the object with trigger_sync", async () => {
      granted.set = new Set(["trigger_sync"]);
      const recheck = vi.spyOn(objectsApi, "recheckObject").mockResolvedValue({ queued: ["material_master"], skipped: [] });
      show(monitor());
      const button = await screen.findByRole("button", { name: "Re-check now" });
      expect(button).toBeEnabled();
      await userEvent.click(button);
      await waitFor(() => expect(recheck).toHaveBeenCalledWith("material_master"));
    });

    it("offers an upload instead of a re-check for an object with no system", async () => {
      granted.set = new Set(["trigger_sync"]);
      show(monitor({ system_id: null, freshness: "manual", cadence: { cron: null, active: null, interval_seconds: null, profile_id: null }, trigger: "upload" }));
      expect(await screen.findByRole("link", { name: "Upload a new file" })).toHaveAttribute("href", "/import");
      expect(screen.queryByRole("button", { name: /Re-check now/ })).toBeNull();
    });

    it("offers Set schedule when there is none, to those who manage systems", async () => {
      granted.set = new Set(["manage_systems"]);
      show(monitor({ freshness: "manual", cadence: { cron: null, active: null, interval_seconds: null, profile_id: null }, next_run_at: null }));
      expect(await screen.findByRole("link", { name: "Set schedule" })).toHaveAttribute("href", "/systems/sys-1?tab=health");
    });

    it("pins this run as the baseline only for those who may analyse", async () => {
      const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: true });
      const view = show(monitor({ baseline: { kind: "previous", version_id: "v1", run_at: "2026-10-12T00:00:00Z" } }));
      await screen.findByTestId("object-monitor");
      expect(screen.queryByRole("button", { name: "Pin this run as baseline" })).toBeNull();
      view.unmount();
      granted.set = new Set(["analyse"]);
      show(monitor({ baseline: { kind: "previous", version_id: "v1", run_at: "2026-10-12T00:00:00Z" } }));
      await userEvent.click(await screen.findByRole("button", { name: "Pin this run as baseline" }));
      await waitFor(() => expect(pin).toHaveBeenCalledWith("v2"));
    });
  });

  it("renders nothing when the API has no monitor for the object", async () => {
    show(null);
    await waitFor(() => expect(objectsApi.getObjectMonitor).toHaveBeenCalled());
    expect(screen.queryByTestId("object-monitor")).toBeNull();
  });
});
