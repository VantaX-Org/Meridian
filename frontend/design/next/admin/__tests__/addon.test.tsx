import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import type { RunSchedule, TenantPatch } from "@/lib/api/v2/admin";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { AdminCanvas } from "../sections/Canvas";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ROW: RunSchedule = {
  id: "rs-1",
  name: "Nightly materials",
  system_id: "sys-1",
  system_name: "ECC production",
  domain: "material_master",
  modules: ["material_master"],
  tables: ["MARA"],
  cadence: { cron: null, preset: "daily" },
  schedule_cron: "0 2 * * *",
  scope: {},
  extraction_mode: "full",
  active: true,
  status: "active",
  last_run_at: null,
  next_run_at: "2026-11-17T02:00:00Z",
};

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  pause: vi.fn(),
  patchTenant: vi.fn(),
}));

vi.mock("@/lib/api/v2/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/v2/admin")>()),
  listRunSchedules: vi.fn(async () => ({ schedules: [ROW] })),
  getRunSchedule: calls.get,
  pauseRunSchedule: calls.pause,
  resumeRunSchedule: vi.fn(),
  patchTenant: calls.patchTenant,
}));

const go = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
const view = (s: string) => renderWithQuery(<ToastProvider><SheetHost><AdminCanvas section={s} /></SheetHost></ToastProvider>);
let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  calls.get.mockReset().mockResolvedValue({ ...ROW, name: "Nightly materials, saved" });
  calls.pause.mockReset().mockResolvedValue({ ...ROW, active: false });
  calls.patchTenant.mockReset().mockResolvedValue({});
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

describe("run schedules: every route of api/routes/schedules.py has a caller", () => {
  it("Edit reads the saved schedule (GET /schedules/{id}) and opens it", async () => {
    go("/more/admin/runschedules?fixture=1");
    view("runschedules");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Nightly materials" }));
    await waitFor(() => expect(calls.get).toHaveBeenCalledWith("rs-1"));
    expect(await screen.findByRole("heading", { name: "Edit Nightly materials, saved" })).toBeInTheDocument();
  });

  it("Pause sends POST /schedules/{id}/pause", async () => {
    go("/more/admin/runschedules?fixture=1");
    view("runschedules");
    fireEvent.click(await screen.findByRole("button", { name: "Pause Nightly materials" }));
    await waitFor(() => expect(calls.pause).toHaveBeenCalledWith("rs-1"));
  });

  it("a viewer without manage_systems gets the permission frame, no schedule actions", async () => {
    go("/more/admin/runschedules?fixture=1&role=viewer");
    view("runschedules");
    expect(await screen.findByText("Run schedules needs the manage systems permission. Ask an administrator to grant it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Nightly materials" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule a run" })).toBeNull();
    expect(calls.get).not.toHaveBeenCalled();
  });
});

describe("PATCH /settings/tenant", () => {
  it("Save the tenant sends only the changed name", async () => {
    go("/more/admin/settings?fixture=1");
    view("settings");
    const input = await screen.findByLabelText(/^Tenant name/);
    fireEvent.change(input, { target: { value: "Komatsu Africa" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the tenant" }));
    await waitFor(() => expect(calls.patchTenant).toHaveBeenCalledTimes(1));
    const body = calls.patchTenant.mock.calls[0][0] as TenantPatch;
    expect(body).toEqual({ name: "Komatsu Africa" });
  });

  it("a viewer without manage_settings gets no tenant form", async () => {
    go("/more/admin/settings?fixture=1&role=viewer");
    view("settings");
    expect(await screen.findByText(/Changing them needs the manage settings permission/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save the tenant" })).toBeNull();
  });
});

describe("the public status page has a journey entry", () => {
  it("Platform and updates links to /status", async () => {
    go("/more/admin/system?fixture=1");
    view("system");
    expect((await screen.findByRole("link", { name: "Open the status page" })).getAttribute("href")).toMatch(/^\/status(\?|$)/);
  });
});
