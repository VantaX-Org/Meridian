import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as licenceApi from "@/lib/api/licence";
import * as doctorApi from "@/lib/api/admin-doctor";
import * as notificationsApi from "@/lib/api/notifications";
import * as retentionApi from "@/lib/api/retention";
import * as settingsApi from "@/lib/api/settings";
import type { LicenceManifest } from "@/lib/api/licence";
import type { DoctorItem } from "@/lib/api/admin-doctor";
import AdminSettingsPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

function mockRetention() {
  vi.spyOn(retentionApi, "getRetention").mockResolvedValue({
    policy: { versions_days: null, reports_days: null, audit_days: null, keep_baseline: true, keep_latest_per_system: 1 },
    enforcement: { flag_enabled: false, dry_run_until: null, enforced: false },
  });
  vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([]);
  vi.spyOn(settingsApi, "getCostModel").mockResolvedValue({ currency: "ZAR", severity: {}, modules: {}, rules: {}, features: {}, impact: {}, config_alignment: {}, subscription_monthly: null });
}

const MANIFEST: LicenceManifest = {
  valid: true, status: "active", tier: "professional", enabled_modules: ["*"], enabled_menu_items: [],
  features: { ask_meridian: true, export_reports: true, run_sync: true, field_mapping_self_service: true, max_users: 10 },
  days_remaining: 120,
};
const ITEM: DoctorItem = { id: "database", label: "Database", status: "ok", detail: null };

describe("admin settings page", () => {
  it("renders licence and health checks once loaded", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
    mockRetention();
    vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue(MANIFEST);
    vi.spyOn(doctorApi, "getDoctor").mockResolvedValue({ items: [ITEM], last_checked: "2026-01-01T00:00:00Z" });
    renderWithQuery(<AdminSettingsPage />);
    await waitFor(() => expect(screen.getAllByText("Database").length).toBeGreaterThan(0));
  });

  it("shows a retryable error when the licence fails to load", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
    mockRetention();
    const spy = vi.spyOn(licenceApi, "getLicenceManifest").mockRejectedValue(new Error("network down"));
    vi.spyOn(doctorApi, "getDoctor").mockResolvedValue({ items: [ITEM], last_checked: "2026-01-01T00:00:00Z" });
    renderWithQuery(<AdminSettingsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(MANIFEST);
    retry.click();
    await waitFor(() => expect(screen.getAllByText("Database").length).toBeGreaterThan(0));
  });
});
