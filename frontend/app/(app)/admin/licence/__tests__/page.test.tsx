import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as licenceApi from "@/lib/api/licence";
import * as updateApi from "@/lib/api/system-update";
import type { LicenceManifest } from "@/lib/api/licence";
import AdminLicencePage from "../page";

const h = vi.hoisted(() => ({ user: { role: "admin", permissions: ["view", "manage_system"] } }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/context/update-modal-context", () => ({ useUpdateModal: () => ({ open: vi.fn() }) }));

const MANIFEST: LicenceManifest = {
  valid: true, status: "active", tier: "professional", enabled_modules: ["*"], enabled_menu_items: [],
  features: { ask_meridian: true, export_reports: true, run_sync: true, field_mapping_self_service: true, max_users: 10 },
  days_remaining: 120,
};

describe("admin licence page", () => {
  it("renders the licence once loaded", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
  });

  it("shows a retryable error when the licence fails to load", async () => {
    const spy = vi.spyOn(licenceApi, "getLicenceManifest").mockRejectedValue(new Error("network down"));
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText(/could not reach the server/i).length).toBeGreaterThan(0));
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue(MANIFEST);
    retry.click();
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
  });

  it("shows Platform version to a platform_admin (gated on manage_system, not the admin key)", async () => {
    h.user = { role: "platform_admin", permissions: ["view", "manage_system"] };
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    vi.spyOn(updateApi, "getUpdateStatus").mockResolvedValue({
      current_version: "1.0.0", latest_version: "1.0.0", update_available: false, release_notes: "", updater_configured: true,
    });
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getByText("Platform version")).toBeTruthy());
  });

  it("hides Platform version from a role without manage_system", async () => {
    h.user = { role: "manager", permissions: ["view", "manage_systems"] };
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
    expect(screen.queryByText("Platform version")).toBeNull();
  });

  it("warns when seats run out, and names the count", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, seats_used: 9 });
    renderWithQuery(<AdminLicencePage />);
    expect(await screen.findByText("9 of 10 seats in use")).toBeInTheDocument();
  });

  it("says nothing about seats below three quarters", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, seats_used: 3 });
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
    expect(screen.queryByText(/seats in use$/)).toBeNull();
  });
});
