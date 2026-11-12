import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, fixtureWrite } from "@/lib/api/v2/fixtures";
import { resetMaintenanceFixture } from "@/lib/api/v2/fixtures/maintenance";
import type { MaintenanceWindow } from "@/lib/api/v2/maintenance";
import * as maintApi from "@/lib/api/v2/maintenance";
import { resetKeptOutcomes } from "../inspector/shared";
import { MaintenanceBlock } from "../admin/maintenance";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "steward", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetMaintenanceFixture();
  resetKeptOutcomes();
  h.allowed = "all";
  setUrl("/admin/settings?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const windows = () => fixtureResponse<{ windows: MaintenanceWindow[] }>("/settings/maintenance", {}).windows;

describe("scheduled maintenance", () => {
  it("adds a window, blocks saving until it ends after it starts, then saves it", async () => {
    renderWithQuery(<MaintenanceBlock />);
    const block = await screen.findByRole("region", { name: "Scheduled maintenance" });
    expect(await within(block).findByDisplayValue("Database upgrade")).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: "Add a window" }));
    const save = within(block).getByRole("button", { name: "Save windows" });
    fireEvent.change(within(block).getByLabelText("Title of window 2"), { target: { value: "SAP kernel patch" } });
    fireEvent.change(within(block).getByLabelText("Start of window 2"), { target: { value: "2030-01-10T22:00" } });
    fireEvent.change(within(block).getByLabelText("End of window 2"), { target: { value: "2030-01-10T21:00" } });
    expect(within(block).getByText("A maintenance window must end after it starts.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(within(block).getByLabelText("End of window 2"), { target: { value: "2030-01-11T02:00" } });
    fireEvent.click(save);
    await waitFor(() => expect(windows().map((w) => w.title)).toEqual(["Database upgrade", "SAP kernel patch"]));
    expect(await within(block).findByText("Maintenance windows saved")).toBeInTheDocument();
  });

  it("the fixture refuses times without a zone, as the route does", () => {
    expect(() => fixtureWrite("PUT", "/settings/maintenance", { windows: [{ title: "x", starts_at: "2030-01-01T00:00", ends_at: "2030-01-01T01:00", detail: null }] }, {})).toThrow(/time zone/);
  });

  it("says when no window is scheduled", async () => {
    vi.spyOn(maintApi, "getMaintenance").mockResolvedValue({ windows: [] } as Awaited<ReturnType<typeof maintApi.getMaintenance>>);
    renderWithQuery(<MaintenanceBlock />);
    expect(await screen.findByTestId("maint-none")).toHaveTextContent("No maintenance window is scheduled.");
  });

  it("is hidden without manage_settings", () => {
    h.allowed = ["view"];
    renderWithQuery(<MaintenanceBlock />);
    expect(screen.queryByRole("region", { name: "Scheduled maintenance" })).toBeNull();
  });
});
