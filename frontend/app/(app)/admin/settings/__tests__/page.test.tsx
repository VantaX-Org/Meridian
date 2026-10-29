import { screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as licenceApi from "@/lib/api/licence";
import * as doctorApi from "@/lib/api/admin-doctor";
import * as notificationsApi from "@/lib/api/notifications";
import * as retentionApi from "@/lib/api/retention";
import * as settingsApi from "@/lib/api/settings";
import * as triageApi from "@/lib/api/triage";
import * as ssoApi from "@/lib/api/sso";
import type { LicenceManifest } from "@/lib/api/licence";
import type { DoctorItem } from "@/lib/api/admin-doctor";
import AdminSettingsPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/lib/permissions", async (orig) => ({ ...(await orig<typeof import("@/lib/permissions")>()), usePermissions: () => ({ can: () => true }) }));

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

  describe("needs setup and the danger zone", () => {
    const TRIAGE = { timezone: "UTC", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00", holidays: [], fallback_user_id: null };
    const SSO = { configured: false, issuer: "", client_id: "", has_secret: false, display_name: "", allowed_domains: [], default_role: "viewer" as const, enforce: false, redirect_uri: "" };
    const mount = (over: { valid?: boolean | null; channels?: number; fallback?: string | null; sso?: boolean } = {}) => {
      mockRetention();
      vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue(over.channels ? [{ id: "c1", kind: "email", target: "a@b.c", digest: "daily", immediate_critical: true, enabled: true, report_pack: "off" } as never] : []);
      vi.spyOn(licenceApi, "getLicenceManifest").mockResolvedValue({ ...MANIFEST, valid: over.valid === undefined ? null : over.valid });
      vi.spyOn(doctorApi, "getDoctor").mockResolvedValue({ items: [ITEM], last_checked: "2026-01-01T00:00:00Z" });
      vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({ ...TRIAGE, fallback_user_id: over.fallback ?? null });
      vi.spyOn(ssoApi, "getSsoConfig").mockResolvedValue({ ...SSO, configured: over.sso ?? false });
      renderWithQuery(<AdminSettingsPage />);
    };

    it("lists every open step at the top, in the warning tone, each with a link", async () => {
      mount();
      const box = await screen.findByRole("alert");
      expect(box).toHaveTextContent("Needs setup");
      await waitFor(() => expect(within(box).getAllByRole("listitem")).toHaveLength(4));
      const steps = within(box).getAllByRole("listitem");
      expect(steps.map((li: HTMLElement) => li.textContent)).toEqual([
        expect.stringContaining("Validate the licence"),
        expect.stringContaining("Add an alert channel"),
        expect.stringContaining("Set a triage fallback user"),
        expect.stringContaining("Set up single sign-on"),
      ]);
      expect(within(box).getByRole("link", { name: "Open licence" })).toHaveAttribute("href", "/admin/licence");
      expect(within(box).getByRole("link", { name: "Add a channel" })).toHaveAttribute("href", "/admin/alerts");
      expect(within(box).getByRole("link", { name: "Set fallback user" })).toHaveAttribute("href", "/admin/triage#calendar");
      expect(within(box).getByRole("link", { name: "Open sign-in" })).toHaveAttribute("href", "/admin/sign-in");
    });

    it("leaves out the steps already done and renders nothing once all are", async () => {
      mount({ valid: true, channels: 1, fallback: "u1", sso: true });
      await screen.findByText("Deployment");
      await waitFor(() => expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull());
      expect(screen.queryByText("Needs setup")).toBeNull();
    });

    it("keeps Delete all data in a danger zone after the health checks, with its two-step confirm", async () => {
      mount({ valid: true, channels: 1, fallback: "u1", sso: true });
      const zone = await screen.findByRole("region", { name: "Danger zone" });
      expect(within(zone).getByRole("heading", { name: "Delete all data" })).toBeInTheDocument();
      expect(within(zone).getByRole("button", { name: "Request purge" })).toHaveClass("m-btn-danger");
      const health = screen.getByRole("region", { name: "Health checks" });
      expect(health.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The retention section no longer carries the purge.
      expect(within(screen.getByRole("region", { name: "Retention" })).queryByRole("button", { name: "Request purge" })).toBeNull();
    });
  });

});
