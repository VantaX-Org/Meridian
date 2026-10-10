import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import * as systemObjectsApi from "@/lib/api/system-objects";
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
});
