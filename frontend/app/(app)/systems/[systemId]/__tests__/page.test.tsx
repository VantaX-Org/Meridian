import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
// one object for the life of the file, as Next hands out, so a URL-state hook does not see a new URL on every render
const searchParams = { get: (k: string) => (k === "tab" ? tab : null), toString: () => (tab ? `tab=${tab}` : "") };
vi.mock("next/navigation", () => ({
  useParams: () => ({ systemId: "s1" }),
  usePathname: () => "/systems/s1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
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

  it("header Test connection runs the shared mutation", async () => {
    mockHappyPath();
    const spy = vi.spyOn(connectivityApi, "testConnection").mockResolvedValue({ status: "healthy", latency_ms: 12 } as never);
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connection tested" })).toBeInTheDocument());
  });

  it("clicking the Active text in the edit form toggles the box", async () => {
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = await screen.findByRole("checkbox", { name: "Active" });
    expect(box).toBeChecked();
    fireEvent.click(screen.getAllByText("Active").find((n) => n.tagName === "LABEL")!);
    expect(box).not.toBeChecked();
  });

  it("writes the system type as its product name and says runs come from uploads when nothing was extracted", async () => {
    mockHappyPath();
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [{ id: "v1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["material_master"], scope: {}, records: {}, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { material_master: 70 } }] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText(/ECC, PRD/)).toBeInTheDocument());
    expect(screen.queryByText(/Ecc/)).toBeNull();
    expect(screen.getAllByText("Runs come from uploads").length).toBeGreaterThan(0);
    expect(screen.queryByText("Nothing extracted yet")).toBeNull();
    expect(screen.queryByText(/0 of /)).toBeNull();
  });

  it("shows the score once, in the ring, not again as a numeral beside it", async () => {
    mockHappyPath();
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [{ id: "v1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["material_master"], scope: {}, records: {}, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { material_master: 70 } }] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    const ring = await screen.findByRole("img", { name: "Score 70" });
    const stat = ring.closest("a");
    expect(stat).toHaveTextContent("DQS");
    expect(stat).not.toHaveTextContent("70.0");
  });

  it("links each run on the Runs tab to its extraction log, a failed one by why it failed", async () => {
    tab = "runs";
    mockHappyPath();
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [
        { id: "r2", run_at: "2026-10-02T00:00:00Z", label: null, status: "failed", objects: ["material_master"], scope: {}, records: {}, analysed_at: null, rule_set: null, baseline: false, analysable: false, dqs: {} },
        { id: "r1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["material_master"], scope: {}, records: {}, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { material_master: 70 } },
      ] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    expect(await screen.findByRole("link", { name: "Why it failed" })).toHaveAttribute("href", "/systems/s1/extractions/r2");
    expect(screen.getByRole("link", { name: "Extraction log" })).toHaveAttribute("href", "/systems/s1/extractions/r1");
  });

  it("ranks the objects by records beside the selected object's summary, with one action", async () => {
    mockHappyPath();
    const mod = (module: string, row_count: number) => ({ module, system_type: "ecc", enabled: true, last_synced_at: null, last_sync_status: null, row_count, config_synced: false });
    vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([mod("fi_gl", 10), mod("accounts_payable", 5000), mod("material_master", 300)] as never);
    renderWithQuery(<SystemPage />);
    const bench = await screen.findByTestId("system-workbench");
    const buttons = within(bench).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Accounts payable"), expect.stringContaining("Material master"), expect.stringContaining("FI general ledger"),
    ]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(bench).getAllByText("5,000 records")).toHaveLength(2); // the row and the selected summary
    fireEvent.click(buttons[1]);
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    // Loaded but not analysed: the one action is in the empty state and leads to the Objects tab's Analyse.
    const empty = within(bench).getByText("Not analysed yet").closest("[data-state='empty']") as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Analyse" })).toHaveAttribute("href", "/systems/s1?tab=objects");
    expect(within(bench).getAllByRole("link")).toHaveLength(1);
  });

  it("offers Extract from the empty summary of an object with no records", async () => {
    mockHappyPath();
    vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([
      { module: "fi_gl", system_type: "ecc", enabled: true, last_synced_at: null, last_sync_status: null, row_count: 0, config_synced: false },
    ] as never);
    renderWithQuery(<SystemPage />);
    const bench = await screen.findByTestId("system-workbench");
    expect(within(bench).getByText("Extract this object to score it.")).toBeInTheDocument();
    const empty = within(bench).getByText("Not analysed yet").closest("[data-state='empty']") as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Extract" })).toHaveAttribute("href", "/systems/s1?tab=objects");
    expect(within(bench).getAllByRole("link")).toHaveLength(1);
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
      fireEvent.click(await screen.findByText("Material master"));
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
      fireEvent.click(await screen.findByText("Material master"));
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
