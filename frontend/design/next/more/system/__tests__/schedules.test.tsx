import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as runs from "@/lib/api/v2/runs";
import * as sys from "@/lib/api/v2/sys";
import type { SystemObject } from "@/lib/api/system-objects";
import type { SyncProfile } from "@/types/api";
import { ToastProvider } from "../../../kit";
import { Schedules } from "../Schedules";

let allowed = true;
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => allowed, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const profile: SyncProfile = { id: "p1", system_id: "s1", domain: "material_master", tables: ["MARA"], schedule_cron: "0 2 * * *", active: true, last_run_at: null, next_run_at: "2026-11-17T02:00:00Z", extraction_mode: "full" };
const obj = (object: string): SystemObject => ({ object, tables: ["KNA1"], config_tables: [], scope_filters: [], date_window: [], last_download: null });
const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  allowed = true;
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/systems");
  vi.spyOn(runs, "getSystemObjectList").mockResolvedValue({ system_type: "ecc", objects: [obj("material_master"), obj("sd_customer_master")] });
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Schedules", () => {
  it("lists the schedules and pauses one", async () => {
    vi.spyOn(runs, "getSystemProfiles").mockResolvedValue([profile]);
    const upd = vi.spyOn(sys, "updateProfile").mockResolvedValue({ ...profile, active: false });
    wrap(<Schedules id="s1" />);
    const table = within(await screen.findByTestId("system-schedules")).getByRole("table");
    expect(within(table).getByText("On")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pause the .* schedule/ }));
    await waitFor(() => expect(upd).toHaveBeenCalledWith("s1", "p1", { active: false }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Schedule paused");
  });

  it("deletes a schedule after the confirm", async () => {
    vi.spyOn(runs, "getSystemProfiles").mockResolvedValue([profile]);
    const del = vi.spyOn(sys, "deleteProfile").mockResolvedValue(undefined as never);
    wrap(<Schedules id="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete the .* schedule/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete schedule" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("s1", "p1"));
  });

  it("adds a schedule for an unscheduled object", async () => {
    vi.spyOn(runs, "getSystemProfiles").mockResolvedValue([profile]);
    const create = vi.spyOn(sys, "createProfile").mockResolvedValue({ ...profile, id: "p2", domain: "sd_customer_master", next_run_at: null });
    wrap(<Schedules id="s1" />);
    const form = await screen.findByRole("form", { name: "Add a schedule" });
    const select = within(form).getAllByRole("combobox")[0];
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(2));
    fireEvent.change(select, { target: { value: "sd_customer_master" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add schedule" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("s1", expect.objectContaining({ domain: "sd_customer_master", tables: ["KNA1"], active: true, extraction_mode: "full" })));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Schedule added");
  });

  it("shows the empty state and the permission note without manage systems", async () => {
    allowed = false;
    vi.spyOn(runs, "getSystemProfiles").mockResolvedValue([]);
    wrap(<Schedules id="s1" />);
    expect(await screen.findByText("Nothing is scheduled for this system. Objects are only checked again when someone extracts them.")).toBeInTheDocument();
    expect(screen.getByText(/needs the manage systems permission/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("shows an error with retry", async () => {
    vi.spyOn(runs, "getSystemProfiles").mockRejectedValue(new Error("boom"));
    wrap(<Schedules id="s1" />);
    expect(await screen.findByText("The schedules could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
