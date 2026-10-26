import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { toast } from "sonner";
import { renderWithQuery } from "@/__tests__/render";
import * as licenceApi from "@/lib/api/licence";
import * as updateApi from "@/lib/api/system-update";
import type { LicenceManifest } from "@/lib/api/licence";
import AdminLicencePage from "../page";

const h = vi.hoisted(() => ({ user: { role: "admin", permissions: ["view", "manage_system"] } }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/context/update-modal-context", () => ({ useUpdateModal: () => ({ open: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

  it("words an expired licence as expired, not as a date still ahead", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, days_remaining: 0 });
    renderWithQuery(<AdminLicencePage />);
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/The licence has expired\. Renew it in Meridian HQ/)).toBeInTheDocument();
    expect(screen.queryByText(/before then/)).toBeNull();
  });

  it("keeps the before-then wording while days remain", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, days_remaining: 5 });
    renderWithQuery(<AdminLicencePage />);
    expect(await screen.findByText(/Renew it in Meridian HQ before then/)).toBeInTheDocument();
  });

  it("does not call seats unlimited before the licence has validated", async () => {
    const { max_users: _omit, ...rest } = MANIFEST.features;
    const features = rest as LicenceManifest["features"]; // an unvalidated manifest carries no max_users
    void _omit;
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, valid: null, features });
    renderWithQuery(<AdminLicencePage />);
    await screen.findByText("Seats");
    expect(screen.queryByText("Unlimited")).toBeNull();
    expect(screen.getAllByText("Not validated yet").length).toBeGreaterThan(0);
  });

  it("says unlimited seats for a validated licence with no seat cap", async () => {
    const { max_users: _omit, ...rest } = MANIFEST.features;
    const features = rest as LicenceManifest["features"]; // an unvalidated manifest carries no max_users
    void _omit;
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, features });
    renderWithQuery(<AdminLicencePage />);
    expect(await screen.findByText("Unlimited")).toBeInTheDocument();
  });

  it("says nothing about seats below three quarters", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, seats_used: 3 });
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
    expect(screen.queryByText(/seats in use$/)).toBeNull();
  });
});

describe("validate now", () => {
  beforeEach(() => {
    h.user = { role: "admin", permissions: ["view", "manage_system"] };
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.spyOn(updateApi, "getUpdateStatus").mockResolvedValue({
      current_version: "1.0.0", latest_version: "1.0.0", update_available: false, release_notes: "", updater_configured: true,
    });
  });

  it("checks the licence with HQ and reloads the manifest", async () => {
    const get = vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    const validate = vi.spyOn(licenceApi, "validateLicence").mockResolvedValue({ ...MANIFEST, tier: "enterprise" });
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
    const calls = get.mock.calls.length;
    get.mockResolvedValue({ ...MANIFEST, tier: "enterprise" });
    fireEvent.click(screen.getByRole("button", { name: "Validate now" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Licence checked with Meridian HQ"));
    expect(validate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText("Enterprise")).toBeInTheDocument();
  });

  it("says why when HQ cannot be reached", async () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    vi.spyOn(licenceApi, "validateLicence").mockRejectedValue(new Error("Meridian HQ could not be reached. Try again shortly"));
    renderWithQuery(<AdminLicencePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Validate now" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("is not offered without manage_system", async () => {
    h.user = { role: "manager", permissions: ["view", "manage_systems"] };
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    renderWithQuery(<AdminLicencePage />);
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Validate now" })).toBeNull();
  });
});
