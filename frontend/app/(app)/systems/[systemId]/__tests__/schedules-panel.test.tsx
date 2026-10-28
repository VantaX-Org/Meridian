import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as triageApi from "@/lib/api/triage";
import * as objectsApi from "@/lib/api/v1/objects";
import { SchedulesPanel } from "../schedules-panel";

describe("SchedulesPanel", () => {
  it("shows each schedule's download mode", async () => {
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "s1", domain: "material_master", tables: ["MARA"], schedule_cron: "0 2 * * *",
        active: true, last_run_at: null, next_run_at: null, extraction_mode: "delta" },
    ]);
    vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({ system_type: "ecc", objects: [] });
    renderWithQuery(<SchedulesPanel id="s1" canManage={false} />);
    expect(await screen.findByText("Changes only")).toBeInTheDocument();
  });

  it("links the tenant zone to where it is set and shows it beside each schedule", async () => {
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({
      timezone: "Africa/Johannesburg", work_days: [1, 2, 3, 4, 5], work_start: "08:00", work_end: "17:00", holidays: [], fallback_user_id: null,
    });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "s1", domain: "material_master", tables: ["MARA"], schedule_cron: "0 2 * * *",
        active: true, last_run_at: null, next_run_at: "2026-01-02T00:00:00Z", extraction_mode: "full" },
    ]);
    vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({ system_type: "ecc", objects: [] });
    renderWithQuery(<SchedulesPanel id="s1" canManage={false} />);
    const link = await screen.findByRole("link", { name: "Africa/Johannesburg" });
    expect(link).toHaveAttribute("href", "/admin/triage#calendar");
    // The zone beside each schedule and its next run only exist once the profiles have loaded; the
    // link above renders before them, so waiting on the link alone counted one occurrence.
    expect(await screen.findByText("2 Jan 2026, 02:00 GMT+2")).toBeInTheDocument();
    expect(screen.getAllByText("Africa/Johannesburg").length).toBeGreaterThan(1);
  });

  it("shows each schedule's freshness beside its status", async () => {
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "s1", domain: "material_master", tables: ["MARA"], schedule_cron: "0 2 * * *",
        active: true, last_run_at: null, next_run_at: null, extraction_mode: "full" },
      { id: "p2", system_id: "s1", domain: "fi_gl", tables: ["BKPF"], schedule_cron: "0 * * * *",
        active: true, last_run_at: null, next_run_at: null, extraction_mode: "full" },
    ]);
    vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({ system_type: "ecc", objects: [] });
    const row = (module: string, profile: string, freshness: objectsApi.Freshness): objectsApi.ObjectMonitor => ({
      module, system_id: "s1", last_run_at: null, last_version_id: null, trigger: null, requested_by_label: null,
      cadence: { cron: "0 2 * * *", active: true, interval_seconds: 86_400, profile_id: profile }, next_run_at: null, freshness,
      baseline: { kind: null, version_id: null, run_at: null },
      drift: { new_failing: 0, recovered: 0, newly_failing_rules: [], recovered_rules: [], newly_failing_rule_count: 0, recovered_rule_count: 0 },
    });
    vi.spyOn(objectsApi, "getObjectsMonitor").mockResolvedValue([row("material_master", "p1", "stale"), row("fi_gl", "p2", "fresh")]);
    renderWithQuery(<SchedulesPanel id="s1" canManage={false} />);
    expect(await screen.findByRole("columnheader", { name: "Freshness" })).toBeInTheDocument();
    const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    await waitFor(() => expect(rowOf("Material master")).toHaveTextContent("Stale"));
    expect(rowOf("FI general ledger")).toHaveTextContent("Fresh");
  });
});
