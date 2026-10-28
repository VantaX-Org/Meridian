import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as pd from "@/lib/api/process-discovery";
import { ProcessSchedules } from "../schedules-card";

const schedule = (over: Partial<pd.ProcessSchedule> = {}): pd.ProcessSchedule => ({
  id: "sch1", system_id: "sys", l1: "PTP", schedule_cron: "0 2 * * *", active: true, mode: "incremental",
  last_run_at: null, next_run_at: "2026-11-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", ...over,
});
const healthRow = (l1: string, over: Partial<pd.ProcessHealth> = {}): pd.ProcessHealth => ({
  l1, last_run: null, previous_fitness: null, fitness_drift: null, schedule: null, freshness: "manual", ...over,
});
const catalogue = (l1: string, name: string) => ({ l1, name, coverage: "discovered", reason: null, last_run: null, in_progress: null, failed: null, sources: [] }) as pd.CatalogueRow;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(pd, "getCatalogue").mockResolvedValue([catalogue("PTP", "Procure to pay"), catalogue("OTC", "Order to cash")]);
  vi.spyOn(pd, "listProcessSchedules").mockResolvedValue([schedule()]);
  vi.spyOn(pd, "getProcessHealth").mockResolvedValue([
    healthRow("PTP", { freshness: "stale", schedule: { id: "sch1", cron: "0 2 * * *", active: true, next_run_at: null },
      last_run: { id: "r1", status: "completed", finished_at: "2026-10-20T00:00:00Z", fitness: 0.9 } }),
    healthRow("OTC"),
  ]);
});

describe("ProcessSchedules", () => {
  it("lists a row per process with its cadence and freshness", async () => {
    renderWithQuery(<ProcessSchedules systemId="sys" canManage={false} />);
    const ptp = (await screen.findByText("Procure to pay")).closest("tr") as HTMLElement;
    expect(ptp).toHaveTextContent("Daily at 02:00");
    expect(ptp).toHaveTextContent("Stale");
    expect(screen.getByText("Order to cash").closest("tr")).toHaveTextContent("Manual only");
  });

  it("gives a viewer no way to create, pause or delete", async () => {
    renderWithQuery(<ProcessSchedules systemId="sys" canManage={false} />);
    await screen.findByText("Procure to pay");
    expect(screen.queryByRole("button", { name: /Pause|Resume|Delete|Add schedule/ })).toBeNull();
    expect(screen.queryByLabelText("Schedule a process")).toBeNull();
  });

  it("lets a manager pause, resume-by-patch and delete after confirming", async () => {
    const patch = vi.spyOn(pd, "updateProcessSchedule").mockResolvedValue(schedule({ active: false }));
    const del = vi.spyOn(pd, "deleteProcessSchedule").mockResolvedValue();
    renderWithQuery(<ProcessSchedules systemId="sys" canManage />);
    await userEvent.click(await screen.findByRole("button", { name: "Pause the Procure to pay schedule" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("sys", "sch1", { active: false }));
    await userEvent.click(screen.getByRole("button", { name: "Delete the Procure to pay schedule" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("no longer mined on a schedule");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete schedule" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("sys", "sch1"));
  });

  it("offers only unscheduled processes to a manager and creates the schedule", async () => {
    const create = vi.spyOn(pd, "createProcessSchedule").mockResolvedValue(schedule({ id: "sch2", l1: "OTC" }));
    renderWithQuery(<ProcessSchedules systemId="sys" canManage />);
    await userEvent.click(await screen.findByRole("combobox", { name: "Schedule a process" }));
    expect(screen.queryByRole("option", { name: "Procure to pay" })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: "Order to cash" }));
    await userEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("sys", { l1: "OTC", schedule_cron: "0 2 * * 1", active: true }));
  });
});
