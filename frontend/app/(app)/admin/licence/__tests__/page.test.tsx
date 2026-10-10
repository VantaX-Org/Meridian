import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as licenceApi from "@/lib/api/licence";
import type { LicenceManifest } from "@/lib/api/licence";
import AdminLicencePage from "../page";

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
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
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue(MANIFEST);
    retry.click();
    await waitFor(() => expect(screen.getAllByText("Professional").length).toBeGreaterThan(0));
  });
});
