import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as configLoadApi from "@/lib/api/config-load";
import * as systemsApi from "@/lib/api/systems";
import type { SAPSystemExtended, SyncProfile } from "@/types/api";
import type { SystemVersion } from "@/lib/api/system-objects";
import SystemsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const SYSTEM: SAPSystemExtended = {
  id: "s1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null,
} as SAPSystemExtended;

describe("systems list page", () => {
  it("renders systems once loaded", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({ versions: [], download: null });
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 1 });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Manual only")).toBeInTheDocument());
  });

  it("shows a retryable error when systems fail to load", async () => {
    const spy = vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(new Error("network down"));
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue([SYSTEM]);
    retry.click();
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("shows the next run time in SAST, not UTC", async () => {
    // Fixed instant: 2026-01-02T22:00:00Z is 2026-01-03T00:00 in SAST (UTC+2) — a date-crossing
    // instant, so a test that silently stayed in UTC would show the wrong day too.
    const PROFILE: SyncProfile = {
      id: "p1", system_id: "s1", domain: "material_master", tables: [], schedule_cron: "0 0 * * *",
      active: true, last_run_at: null, next_run_at: "2026-01-02T22:00:00Z",
    };
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({ versions: [], download: null });
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 1 });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([PROFILE]);
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText(/3 Jan 2026, 00:00 SAST/)).toBeInTheDocument());
  });

  it("shows an up/down trend arrow with an aria-label once the DQS move passes the 0.05 threshold", async () => {
    const mkVersion = (run_at: string, dqs: number): SystemVersion => ({
      id: run_at, run_at, label: null, status: "complete", objects: ["accounts_payable"],
      scope: {}, records: {}, analysed_at: run_at, rule_set: null, baseline: false, analysable: true,
      dqs: { accounts_payable: dqs }, field_status: [], extraction_complete: true,
      coverage: { read: 100, issues: [] }, outliers: {},
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [mkVersion("2026-01-01T00:00:00Z", 80), mkVersion("2026-01-02T00:00:00Z", 80.2)],
      download: null,
    });
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 1 });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByLabelText("Up 0.2 since the previous run")).toBeInTheDocument());
  });

  it("hides the trend arrow when the DQS move is below the 0.05 threshold", async () => {
    const mkVersion = (run_at: string, dqs: number): SystemVersion => ({
      id: run_at, run_at, label: null, status: "complete", objects: ["accounts_payable"],
      scope: {}, records: {}, analysed_at: run_at, rule_set: null, baseline: false, analysable: true,
      dqs: { accounts_payable: dqs }, field_status: [], extraction_complete: true,
      coverage: { read: 100, issues: [] }, outliers: {},
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [mkVersion("2026-01-01T00:00:00Z", 80), mkVersion("2026-01-02T00:00:00Z", 80.02)],
      download: null,
    });
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 1 });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText("80.0")).toBeInTheDocument());
    expect(screen.queryByLabelText(/since the previous run/)).not.toBeInTheDocument();
  });
});
