import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as triageApi from "@/lib/api/triage";
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
});
