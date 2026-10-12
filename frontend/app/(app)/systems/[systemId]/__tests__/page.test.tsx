import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as sourceDesignApi from "@/lib/api/source-design";
import * as configLoadApi from "@/lib/api/config-load";
import * as configPairingApi from "@/lib/api/config-pairing";
import * as pilotApi from "@/lib/api/pilot";
import type { SAPSystemExtended } from "@/types/api";
import SystemPage from "../page";

let tab: string | null = null;
vi.mock("next/navigation", () => ({
  useParams: () => ({ systemId: "s1" }),
  usePathname: () => "/systems/s1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "tab" ? tab : null), toString: () => (tab ? `tab=${tab}` : "") }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const SYSTEM: SAPSystemExtended = {
  id: "s1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true, role: "source", target_system_id: null,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null,
} as SAPSystemExtended;

function mockHappyPath() {
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
  vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([]);
  vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({ versions: [], download: null });
  vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({ summary: [], series: {} });
  vi.spyOn(sourceDesignApi, "getDesign").mockResolvedValue({
    system_type: "ecc", discovery_status: null, discovered_at: null, sap_release: null, sap_product: null,
    config_sync_status: null, config_synced_at: null, snapshot: null, configuration: [],
  });
  vi.spyOn(configLoadApi, "getConfigLoad").mockResolvedValue(null);
  vi.spyOn(configPairingApi, "getConfigCompare").mockResolvedValue({
    source_load_id: null, target: { system_id: null, label: "baseline target", baseline: true }, objects: [], rows: [],
  });
  vi.spyOn(pilotApi, "getScorecard").mockResolvedValue({
    precision: { reviewed: 0, false_positives: 0, precision: null, min_reviewed_per_rule: 10, target: 0.9 },
    rules: [],
    recall: { known: 0, caught: 0, recall: null, missed: [], missed_total: 0, objects_not_analysed: [] },
  });
}

describe("system detail page", () => {
  beforeEach(() => { tab = null; });

  it("renders the system once loaded", async () => {
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("shows the system role in the header", async () => {
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    expect(await screen.findByText("Source system")).toBeInTheDocument();
  });

  it("shows a retryable error when the systems list fails to load", async () => {
    const refetch = vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(new Error("network down"));
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    refetch.mockResolvedValue([SYSTEM]);
    retry.click();
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("lands on the pilot tab when ?tab=pilot is present", async () => {
    tab = "pilot";
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pilot", selected: true })).toBeInTheDocument());
  });

  it("selects the tab named by a Stat href (?tab=health)", async () => {
    tab = "health";
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Health", selected: true })).toBeInTheDocument());
  });

  it("shows a loading skeleton while the system loads", () => {
    vi.spyOn(connectivityApi, "getSystems").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<SystemPage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  describe("after starting an extraction", () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });

    it("polls for the started job, then gives up after the deadline when it never reports", async () => {
      mockHappyPath();
      const versions = vi.spyOn(systemObjectsApi, "getSystemVersions");
      vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({
        system_type: "ecc",
        objects: [{ object: "material_master", tables: ["MARA"], config_tables: [], scope_filters: [], date_window: [], last_download: null }],
      });
      vi.spyOn(systemObjectsApi, "startDownload").mockResolvedValue({ job_id: "dl-9", status: "queued" });
      renderWithQuery(<SystemPage />);
      fireEvent.click((await screen.findAllByText("Extract"))[0]);
      fireEvent.click(await screen.findByText("Material Master"));
      fireEvent.click(screen.getByText("Extract 1 object"));
      fireEvent.click(await screen.findByText("Confirm"));
      await waitFor(() => expect(systemObjectsApi.startDownload).toHaveBeenCalled());

      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      const during = versions.mock.calls.length;
      expect(during).toBeGreaterThan(2); // still polling: no progress for dl-9 yet

      await act(async () => { await vi.advanceTimersByTimeAsync(110_000); }); // past the 120 s deadline
      const after = versions.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
      expect(versions.mock.calls.length).toBe(after); // polling stopped
    });

    it("stops polling as soon as the awaited job reports a terminal status, before the deadline", async () => {
      mockHappyPath();
      const versions = vi.spyOn(systemObjectsApi, "getSystemVersions");
      vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({
        system_type: "ecc",
        objects: [{ object: "material_master", tables: ["MARA"], config_tables: [], scope_filters: [], date_window: [], last_download: null }],
      });
      vi.spyOn(systemObjectsApi, "startDownload").mockResolvedValue({ job_id: "dl-9", status: "queued" });
      renderWithQuery(<SystemPage />);
      fireEvent.click((await screen.findAllByText("Extract"))[0]);
      fireEvent.click(await screen.findByText("Material Master"));
      fireEvent.click(screen.getByText("Extract 1 object"));
      versions.mockResolvedValue({
        versions: [],
        download: { status: "complete", job_id: "dl-9", started_at: "2026-01-01T10:00:00Z", label: null, objects: [] },
      });
      fireEvent.click(await screen.findByText("Confirm"));
      await waitFor(() => expect(systemObjectsApi.startDownload).toHaveBeenCalled());

      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const settled = versions.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // well inside the 120 s deadline
      expect(versions.mock.calls.length).toBe(settled);
    });
  });
});
