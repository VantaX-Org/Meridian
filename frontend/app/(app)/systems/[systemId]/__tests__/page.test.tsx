import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as sourceDesignApi from "@/lib/api/source-design";
import * as configLoadApi from "@/lib/api/config-load";
import * as configPairingApi from "@/lib/api/config-pairing";
import * as pilotApi from "@/lib/api/pilot";
import * as systemsApi from "@/lib/api/systems";
import type { SAPSystemExtended } from "@/types/api";
import { toast } from "@/design";
import SystemPage from "../page";

let tab: string | null = null;
let extract: string | null = null;
// one object for the life of the file, as Next hands out, so a URL-state hook does not see a new URL on every render
// built over a real URLSearchParams so every reader the page uses (get, getAll, has, toString) behaves as in Next
const currentParams = (): URLSearchParams => {
  const p = new URLSearchParams();
  if (tab) p.set("tab", tab);
  if (extract) p.set("extract", extract);
  return p;
};
const searchParams = {
  get: (k: string) => currentParams().get(k),
  getAll: (k: string) => currentParams().getAll(k),
  has: (k: string) => currentParams().has(k),
  toString: () => currentParams().toString(),
};
vi.mock("next/navigation", () => ({
  useParams: () => ({ systemId: "s1" }),
  usePathname: () => "/systems/s1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
/** The actions the viewer lacks; empty means every action is allowed. */
let denied = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => !denied.has(a), loading: false }) }));

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
  beforeEach(() => { tab = null; extract = null; denied = new Set(); vi.restoreAllMocks(); });

  describe("edit form connection test", () => {
    const openEdit = async () => {
      mockHappyPath();
      vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ ...SYSTEM, host: "old.internal", client: "100", sysnr: "00", auth_type: "rfc" }]);
      vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
      renderWithQuery(<SystemPage />);
      await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      return screen.findByLabelText("Host");
    };

    it("tries the edited host, not the stored connection, with the secret left for the API to fill in", async () => {
      const stored = vi.spyOn(connectivityApi, "testConnection");
      const draft = vi.spyOn(systemsApi, "testEditedConnection").mockResolvedValue({ connected: false, message: "Connection failed: host not found" });
      const host = await openEdit();
      fireEvent.change(host, { target: { value: "new.internal" } });
      fireEvent.click(screen.getAllByRole("button", { name: "Test connection" }).at(-1)!);
      await waitFor(() => expect(draft).toHaveBeenCalledOnce());
      expect(stored).not.toHaveBeenCalled();
      expect(draft.mock.calls[0]![0]).toBe("s1");
      expect(draft.mock.calls[0]![1]).toMatchObject({ system_type: "ecc", host: "new.internal", client: "100", sysnr: "00", credentials: {} });
      // The outcome stays in the form, not only in a toast.
      expect(await screen.findByText("Not connected")).toBeInTheDocument();
      expect(screen.getByText("Connection failed: host not found")).toBeInTheDocument();
    });

    it("marks the result out of date when a connection field changes after the test", async () => {
      vi.spyOn(systemsApi, "testEditedConnection").mockResolvedValue({ connected: true, message: "Connection successful" });
      const host = await openEdit();
      fireEvent.click(screen.getAllByRole("button", { name: "Test connection" }).at(-1)!);
      expect(await screen.findByText("Connected")).toBeInTheDocument();
      fireEvent.change(host, { target: { value: "other.internal" } });
      expect(screen.getByText("Test result out of date")).toBeInTheDocument();
      expect(screen.queryByText("Connected")).toBeNull();
      // Back to the tested values: the result describes them again.
      fireEvent.change(host, { target: { value: "old.internal" } });
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    it("applies the connect dialog's rules: a bad client blocks the test and the save", async () => {
      const save = vi.spyOn(systemsApi, "updateSystem").mockResolvedValue({} as never);
      await openEdit();
      fireEvent.change(screen.getByLabelText("Client"), { target: { value: "12" } });
      expect(screen.getAllByRole("button", { name: "Test connection" }).at(-1)).toBeDisabled();
      expect(screen.getByText("To test, complete the client")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("Enter a 3-digit client")).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
      // An empty password is fine here: the stored one is kept.
      fireEvent.change(screen.getByLabelText("Client"), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(save.mock.calls[0]![1]).toMatchObject({ client: "200" });
      expect(save.mock.calls[0]![1]).not.toHaveProperty("credentials");
    });
  });

  describe("without manage_systems", () => {
    it("offers no edit drawer and points a failed test to an admin", async () => {
      denied = new Set(["manage_systems"]);
      mockHappyPath();
      vi.spyOn(connectivityApi, "testConnection").mockResolvedValue({ status: "auth_failed", message: "Logon failed", latency_ms: 10 });
      const error = vi.spyOn(toast, "error").mockReturnValue(1);
      renderWithQuery(<SystemPage />);
      await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() => expect(error).toHaveBeenCalled());
      const [, options] = error.mock.calls[0]!;
      expect(options).toEqual({ description: "Ask an admin to update the credentials." });
      expect(screen.queryByRole("button", { name: "Remove system" })).toBeNull();
    });

    it("offers Update credentials on a failed test to whoever may edit the system", async () => {
      mockHappyPath();
      vi.spyOn(connectivityApi, "testConnection").mockResolvedValue({ status: "auth_failed", message: "Logon failed", latency_ms: 10 });
      const error = vi.spyOn(toast, "error").mockReturnValue(1);
      renderWithQuery(<SystemPage />);
      await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(error.mock.calls[0]![1]).toMatchObject({ action: { label: "Update credentials" } });
    });
  });

  describe("?extract=1", () => {
    it("says why nothing opens when the viewer cannot extract", async () => {
      extract = "1";
      denied = new Set(["trigger_sync"]);
      mockHappyPath();
      renderWithQuery(<SystemPage />);
      expect(await screen.findByText("You cannot extract from ECC Prod")).toBeInTheDocument();
      expect(screen.getByText(/Extraction needs the SAP Basis role on this system/)).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the Extract drawer for a viewer who can extract", async () => {
      extract = "1";
      mockHappyPath();
      vi.spyOn(systemObjectsApi, "getSystemObjects").mockResolvedValue({ system_type: "ecc", objects: [] });
      renderWithQuery(<SystemPage />);
      expect(await screen.findByRole("dialog", { name: "Extract from ECC Prod" })).toBeInTheDocument();
      expect(screen.queryByText("You cannot extract from ECC Prod")).toBeNull();
    });
  });

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

  it("leads with Test connection, not Extract, until the connection is healthy", async () => {
    mockHappyPath();
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ ...SYSTEM, health_status: "unreachable" } as SAPSystemExtended]);
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Test connection" })).toHaveClass("m-btn-primary");
    expect(screen.getAllByRole("button", { name: "Extract" })[0]).toHaveClass("m-btn-secondary");
  });

  it("edits an OAuth system's token URL and sends it with the save", async () => {
    mockHappyPath();
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{
      ...SYSTEM, name: "BTP Prod", system_type: "btp", base_url: "https://api.example", auth_type: "oauth2_client_credentials",
      token_url: "https://old.example/oauth/token",
    }]);
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
    const save = vi.spyOn(systemsApi, "updateSystem").mockResolvedValue({} as never);
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText("BTP Prod")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const field = await screen.findByLabelText("Token URL");
    expect(field).toHaveValue("https://old.example/oauth/token");
    expect(screen.queryByText(/cannot be changed here/)).toBeNull();

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the token URL")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: " https://new.example/oauth/token " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toBe("s1");
    expect(save.mock.calls[0][1]).toMatchObject({ token_url: "https://new.example/oauth/token", base_url: "https://api.example" });
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

  it("writes the system type as its product name and counts the latest run's objects when nothing was extracted", async () => {
    mockHappyPath();
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [{ id: "v1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["material_master"], scope: {}, records: { material_master: 7 }, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { material_master: 70 } }] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText(/ECC, PRD/)).toBeInTheDocument());
    expect(screen.queryByText(/Ecc/)).toBeNull();
    // KMZ-SIM said "Objects loaded —, Runs come from uploads" beside a run of 7 records and its findings.
    expect(screen.getAllByText("7 records in the latest run").length).toBeGreaterThan(0);
    expect(screen.queryByText("Runs come from uploads")).toBeNull();
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
    const ring = await screen.findByRole("img", { name: "Score 70.0" });
    const stat = ring.closest("a");
    expect(stat).toHaveTextContent("Score");
    expect(stat).not.toHaveTextContent("Quality score");
    // The ring prints the one numeral (70.0); no second numeral beside it.
    expect(stat?.textContent?.match(/70(\.0)?/g)).toHaveLength(1);
  });

  it("opens the latest run's Findings tab from the score and failing-rules tiles", async () => {
    mockHappyPath();
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [{ id: "v1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["material_master"], scope: {}, records: {}, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { material_master: 70 } }] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    const ring = await screen.findByRole("img", { name: "Score 70.0" });
    expect(ring.closest("a")).toHaveAttribute("href", "/runs/v1?tab=findings");
    const open = screen.getByText("Failing rules").closest("a");
    expect(open).toHaveAttribute("href", "/runs/v1?tab=findings");
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

  it("charts the same record counts as the list, says how many objects are loaded, and never 'no rows' beside 7 records", async () => {
    mockHappyPath();
    const mod = (module: string, row_count: number) => ({ module, system_type: "ecc", enabled: true, last_synced_at: null, last_sync_status: null, row_count, config_synced: false });
    vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([mod("accounts_payable", 0), mod("fi_gl", 0), mod("material_master", 0)] as never);
    // Records come from the latest run only (an uploaded or analysed run), not from an extraction.
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({
      versions: [{ id: "v1", run_at: "2026-10-01T00:00:00Z", label: null, status: "complete", objects: ["accounts_payable"], scope: {}, records: { accounts_payable: 7 }, analysed_at: "2026-10-01T00:00:00Z", rule_set: null, baseline: false, analysable: true, dqs: { accounts_payable: 70 } }] as never,
      download: null,
    });
    renderWithQuery(<SystemPage />);
    const bench = await screen.findByTestId("system-workbench");
    expect(within(bench).getByText("3 objects, 1 loaded; most records first")).toBeInTheDocument();
    expect(within(bench).getAllByText("7 records").length).toBeGreaterThan(0);
    const chart = screen.getByText("Objects by records").closest("section, div[class]")!.parentElement as HTMLElement;
    expect(within(chart).queryByText("No rows loaded yet")).toBeNull();
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
    expect(within(empty).getByRole("button", { name: "Extract" })).toBeInTheDocument();
    expect(within(bench).queryAllByRole("link")).toHaveLength(0); // the one action is the Extract button, which opens the Extract drawer
  });

  it("on the Objects tab, says why Extract again and Analyse are off", async () => {
    tab = "objects";
    mockHappyPath();
    vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([
      { module: "fi_gl", system_type: "ecc", enabled: false, last_synced_at: null, last_sync_status: null, row_count: 10, config_synced: false },
    ] as never);
    renderWithQuery(<SystemPage />);
    const extractBtn = await screen.findByRole("button", { name: /^Extract again\. This object is turned off for this system/ });
    expect(extractBtn).toBeDisabled();
    const analyseBtn = screen.getByRole("button", { name: /^Analyse\. No finished extraction of this object to analyse yet/ });
    expect(analyseBtn).toBeDisabled();
  });

  it("on the Objects tab, badges an object whose extraction source is unverified as Preview", async () => {
    tab = "objects";
    mockHappyPath();
    vi.spyOn(connectivityApi, "getSystemModules").mockResolvedValue([
      { module: "fi_gl", system_type: "successfactors", enabled: true, last_synced_at: null, last_sync_status: null, row_count: 10, config_synced: false, preview_sources: [] },
      { module: "learning_management", system_type: "successfactors", enabled: true, last_synced_at: null, last_sync_status: null, row_count: 5, config_synced: false,
        preview_sources: [{ source: "LearningHistoryV1", reason: "not in canonical/successfactors.yaml" }] },
    ] as never);
    renderWithQuery(<SystemPage />);
    const badge = await screen.findByLabelText("Preview: LearningHistoryV1. Source name not yet verified against SAP; extraction may fail");
    expect(badge).toHaveTextContent("Preview");
    expect(screen.getAllByText("Preview")).toHaveLength(1); // only the unverified object
  });

  it("shows the system role in the header", async () => {
    mockHappyPath();
    renderWithQuery(<SystemPage />);
    expect(await screen.findByText("Source system")).toBeInTheDocument();
  });

  it("says the system is gone and links back to the list when the id is unknown", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<SystemPage />);
    expect(await screen.findByText("System not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open systems" })).toHaveAttribute("href", "/systems");
  });

  it("shows a retryable error when the systems list fails to load", async () => {
    const refetch = vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(new Error("network down"));
    renderWithQuery(<SystemPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
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
      fireEvent.click(screen.getByText("Extract 1 object only"));
      fireEvent.click(await screen.findByText("Start extract"));
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
      fireEvent.click(screen.getByText("Extract 1 object only"));
      versions.mockResolvedValue({
        versions: [],
        download: { status: "complete", job_id: "dl-9", started_at: "2026-01-01T10:00:00Z", label: null, objects: [] },
      });
      fireEvent.click(await screen.findByText("Start extract"));
      await waitFor(() => expect(systemObjectsApi.startDownload).toHaveBeenCalled());

      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const settled = versions.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // well inside the 120 s deadline
      expect(versions.mock.calls.length).toBe(settled);
    });
  });
});
