import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { RunSchedulesSection } from "../admin/runschedules";
import { SettingsSection } from "../admin/settings";
import { resetKeptOutcomes } from "../inspector/shared";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetRunsFixture();
  resetKeptOutcomes();
  undo = stubLayout(900, 2000);
  h.allowed = "all";
  setUrl("/admin/runschedules?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const schedules = () => renderWithQuery(<ToastProvider><RunSchedulesSection /></ToastProvider>);
const settings = () => renderWithQuery(<ToastProvider><SettingsSection /></ToastProvider>);
const rows = () => within(screen.getByRole("grid", { name: "Run schedules" })).getAllByRole("row").slice(1);

describe("Admin: run schedules", () => {
  it("lists every schedule with its rhythm and state", async () => {
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent("Weekly material master");
    expect(rows()[1]).toHaveTextContent("Paused");
  });

  it("creates a schedule from the dialog", async () => {
    const create = vi.spyOn(adminApi, "createRunSchedule");
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Schedule a run" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule a run" });
    const go = within(dialog).getByRole("button", { name: "Create the schedule" });
    expect(go).toBeDisabled();
    const system = within(dialog).getByLabelText("System") as HTMLSelectElement;
    await waitFor(() => expect(system.options.length).toBeGreaterThan(1));
    fireEvent.change(system, { target: { value: system.options[1].value } });
    await waitFor(() => expect(within(dialog).getAllByRole("checkbox").length).toBeGreaterThan(1));
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0]);
    fireEvent.change(within(dialog).getByLabelText("Name (optional)"), { target: { value: "Nightly check" } });
    fireEvent.change(within(dialog).getByLabelText(/Company codes/), { target: { value: "1000, 2000" } });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ name: "Nightly check", preset: "weekly", cron: null, scope: expect.objectContaining({ company_codes: ["1000", "2000"] }) });
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it("pauses and resumes a schedule", async () => {
    const pause = vi.spyOn(adminApi, "pauseRunSchedule");
    const resume = vi.spyOn(adminApi, "resumeRunSchedule");
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Pause Weekly material master" }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith("rs-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Resume Weekly material master" }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("rs-1"));
  });

  it("edits a schedule", async () => {
    const patch = vi.spyOn(adminApi, "patchRunSchedule");
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Edit Weekly material master" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Weekly material master" });
    fireEvent.change(within(dialog).getByLabelText("Name (optional)"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the schedule" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe("rs-1");
    expect(patch.mock.calls[0][1]).toMatchObject({ name: "Renamed" });
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Renamed"));
  });

  it("deletes a schedule only after the in-page confirm", async () => {
    const del = vi.spyOn(adminApi, "deleteRunSchedule");
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Delete Weekly material master" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Weekly material master" });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the schedule" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("rs-1"));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("offers nothing without the manage systems permission", async () => {
    h.allowed = ["view"];
    schedules();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Schedule a run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause Weekly material master" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Weekly material master" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Weekly material master" })).toBeDisabled();
  });
});

describe("Admin: tenant profile", () => {
  it("saves a changed name and currency, and only the changed keys", async () => {
    const patch = vi.spyOn(adminApi, "patchTenant");
    settings();
    const name = await screen.findByLabelText("Tenant name");
    const save = screen.getByRole("button", { name: "Save the tenant" });
    expect(save).toBeDisabled();
    fireEvent.change(name, { target: { value: "Acme Holdings" } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ name: "Acme Holdings" }));
    await waitFor(() => expect(screen.getByText("Tenant saved")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Tenant currency/),{ target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the tenant" }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith({ currency: "USD" }));
  });

  it("blocks a currency that is not three capital letters", async () => {
    settings();
    const cur = await screen.findByLabelText(/Tenant currency/);
    fireEvent.change(cur, { target: { value: "zar1" } });
    expect(screen.getByRole("button", { name: "Save the tenant" })).toBeDisabled();
  });

  it("is read only without the manage settings permission", async () => {
    h.allowed = ["view"];
    settings();
    await screen.findByText("Demo Corp");
    expect(screen.queryByLabelText("Tenant name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save the tenant" })).toBeNull();
  });
});
