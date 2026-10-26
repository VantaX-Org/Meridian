import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as configLoadApi from "@/lib/api/config-load";
import * as miningApi from "@/lib/api/process-mining";
import * as versionsApi from "@/lib/api/versions";
import ProcessInsightsPage from "../page";

const nav = vi.hoisted(() => ({ qs: "" }));

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.qs),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/insights/process",
}));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));

const LATEST = {
  id: "v1", label: "Run 1", status: "complete", run_at: "2026-01-01T00:00:00Z",
  dqs_summary: { material_master: 90 },
};

describe("ProcessInsightsPage", () => {
  it("renders readiness for the latest version's first object", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([
      {
        l1_id: "l1", l1_name: "Procure to pay", l1_description: "", system: "ecc",
        l2_groups: [{
          l2_id: "l2", l2_name: "Source", l3_processes: [{
            l3_id: "l3", l3_name: "Create PO", description: "", overall_readiness: "green",
            l4_subprocesses: [{
              l4_id: "l4", l4_name: "ME21N", tcode: "ME21N", description: "", config_dependency: null,
              step_status: "green",
              activities: [{ l5_id: "l5", l5_name: "Create", description: "", tcode: "ME21N", fields: [], check_ids: [], activity_status: "green" }],
            }],
          }],
        }],
      },
    ]);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({
      results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] },
    });
    vi.spyOn(miningApi, "getMiningGraph").mockResolvedValue({
      version_id: "v1", module: "material_master", activities: [], transitions: [], variants: [], cases: [], cases_supported: false,
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    await waitFor(() => expect(screen.getByText("Process steps")).toBeInTheDocument());
    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
    // Readiness and Map are a toggle, not a second tab strip under the view's tabs.
    expect(screen.getByRole("button", { name: "Readiness" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".m-tabs-list").length).toBeLessThanOrEqual(1);
    // The blocking ledger is not a card inside a card, and step verdicts use the one Status vocabulary.
    expect(screen.getByRole("region", { name: "Blocking findings" }).closest(".m-card")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("is titled Process data readiness and links to how the process actually runs, on the run's system", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ ...LATEST, metadata: { system_id: "sys-9" } } as never] });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([
      { l1_id: "PTP", l1_name: "Procure to pay", l1_description: "", system: "ecc", l2_groups: [] },
    ] as never);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({
      results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] },
    });
    vi.spyOn(miningApi, "getMiningGraph").mockResolvedValue({
      version_id: "v1", module: "material_master", activities: [], transitions: [], variants: [], cases: [], cases_supported: false,
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    const link = await screen.findByRole("link", { name: "See how this process actually runs" }, { timeout: 5000 });
    expect(link.getAttribute("href")).toBe("/process/PTP?system=sys-9");
    expect(link.className).toContain("underline underline-offset-2");
    expect(screen.getAllByText("Process data readiness").length).toBeGreaterThan(0);
    expect(screen.queryByText("Process readiness")).toBeNull();
  });

  it("heads each block under Rules by step one level below the card", async () => {
    const tally = { applicable: 4, not_applicable: 0, passes: 3, by_default: 4, score: 75, not_applicable_reasons: [], not_applicable_rules: [], top_failing: [] };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([
      { l1_id: "l1", l1_name: "Procure to pay", l1_description: "", system: "ecc", l2_groups: [] },
    ] as never);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({
      results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] },
    });
    vi.spyOn(miningApi, "getMiningGraph").mockResolvedValue({
      version_id: "v1", module: "material_master", activities: [], transitions: [], variants: [], cases: [], cases_supported: false,
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(configLoadApi, "getConfigAwareScore").mockResolvedValue({
      version_id: "v1", system_type: null, config_load: null, existing_dqs: null, config_aware: tally, unmapped: null, modules: [], rules: [],
      processes: [{ ...tally, l1: "l1", name: "Procure to pay", l2: [{ ...tally, l2: "l2", name: "Source", configured_in: [] }] }],
    });
    renderWithQuery(<ProcessInsightsPage />);
    const block = (await screen.findAllByText(/rules that apply/, undefined, { timeout: 5000 }))[0].closest("#applicability") as HTMLElement;
    expect(within(block).getByRole("heading", { level: 3, name: "Procure to pay" })).toBeInTheDocument();
    expect(within(block).getByRole("heading", { level: 3, name: "Source" })).toBeInTheDocument();
    expect(within(block).queryByRole("heading", { level: 4 })).toBeNull();
  });

  it("shows an error state for readiness and retries on click", async () => {
    vi.spyOn(versionsApi, "getVersions").mockRejectedValue(new Error("versions service unavailable"));
    renderWithQuery(<ProcessInsightsPage />);
    await screen.findByText("Could not reach the server.");
    const calls = (versionsApi.getVersions as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((versionsApi.getVersions as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});

describe("ProcessInsightsPage blocking ledger", () => {
  it("names the rule in Mono, links every row to its records and reads unmapped gates as No fields mapped", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    const field = { field: "LFA1.STCD1", description: "Tax number", mandatory: true, config_source: "", check_id: "AP001",
      dq_status: "red" as const, pass_rate: 40, affected_count: 321, finding_message: "Tax number missing" };
    const l4 = (id: string, fields: (typeof field)[]) => ({
      l4_id: id, l4_name: id, tcode: "FK01", description: "", config_dependency: null, step_status: "red" as const,
      activities: [{ l5_id: `${id}-a`, l5_name: "Enter", description: "", tcode: "FK01", fields, check_ids: [], activity_status: "red" as const }],
    });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([{
      l1_id: "PTP", l1_name: "Procure to pay", l1_description: "", system: "ecc",
      l2_groups: [{ l2_id: "l2", l2_name: "Vendors", l3_processes: [
        { l3_id: "g1", l3_name: "Onboarding", description: "", overall_readiness: "red", l4_subprocesses: [l4("FK01", [field])] },
        { l3_id: "g2", l3_name: "Payment", description: "", overall_readiness: "green", l4_subprocesses: [l4("F110", [])] },
      ] }],
    }]);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({ results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] } });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    expect(await screen.findByText("AP001")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Fix / }).length).toBeGreaterThan(0);
    expect(screen.getByText("No fields mapped")).toBeInTheDocument();
    expect(screen.getAllByText("No-go").length).toBeGreaterThan(0);
  });
});

describe("ProcessInsightsPage without a process definition", () => {
  afterEach(() => { nav.qs = ""; vi.restoreAllMocks(); });

  it("opens on the current state: the process object of an older run, read from its own run", async () => {
    const bp = { id: "bp", label: "business_partner_1k", status: "complete", run_at: "2026-10-02T00:00:00Z", dqs_summary: { business_partner: 90 } };
    const ap = { id: "ap", label: "accounts_payable_1k", status: "complete", run_at: "2026-10-01T00:00:00Z", dqs_summary: { accounts_payable: 80 } };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [bp as never, ap as never] });
    const read = vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([]);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({ results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] } });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    // The newest run (business partner) carries no process; the current state still offers accounts payable.
    await waitFor(() => expect(read).toHaveBeenCalledWith("ap", "accounts_payable"));
    expect(read).not.toHaveBeenCalledWith("bp", expect.anything());
  });

  it("offers the finished runs that cover a process object instead of a dead end, with the header and actions at page level", async () => {
    nav.qs = "run=bp";
    const bp = { id: "bp", label: "business_partner_1k", status: "complete", run_at: "2026-10-02T00:00:00Z", dqs_summary: { business_partner: 90 } };
    const ap = { id: "ap", label: "accounts_payable_1k", status: "complete", run_at: "2026-10-01T00:00:00Z", dqs_summary: { accounts_payable: 80 } };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [bp as never, ap as never] });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([]);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({ results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] } });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    expect(await screen.findByText("Business partner has no process definition")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Runs with a process definition" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Runs with a process definition" }));
    expect(await screen.findByRole("option", { name: /accounts_payable_1k, Accounts payable/ })).toBeInTheDocument();
    // The four sentences come from the frame, once, with the shared action bar beside the title.
    expect(screen.getByText("Business partner has no L1 to L5 process definition.")).toBeInTheDocument();
  });
});

describe("ProcessInsightsPage named L1", () => {
  const bp = (id: string, name: string) => ({
    l1_id: id, l1_name: name, l1_description: "", system: "ecc",
    l2_groups: [{ l2_id: `${id}-2`, l2_name: "Area", l3_processes: [{
      l3_id: `${id}-3`, l3_name: `${name} step`, description: "", overall_readiness: "green" as const,
      l4_subprocesses: [{ l4_id: `${id}-4`, l4_name: "Sub", tcode: "VA01", description: "", config_dependency: null, step_status: "green" as const,
        activities: [{ l5_id: `${id}-5`, l5_name: "Enter", description: "", tcode: "VA01", fields: [], check_ids: [], activity_status: "green" as const }] }],
    }] }],
  });
  const setup = (run: Record<string, unknown>, processes: ReturnType<typeof bp>[]) => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [run as never] });
    const read = vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue(processes);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({ results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] } });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    return read;
  };
  afterEach(() => { nav.qs = ""; vi.restoreAllMocks(); });

  it("reads an object of the named L1, not the object in the link when it belongs to another L1", async () => {
    nav.qs = "l1=OTC&object=accounts_payable&run=v2";
    const read = setup({ id: "v2", label: "Run 2", status: "complete", run_at: "2026-01-02T00:00:00Z",
      dqs_summary: { accounts_payable: 80, sd_customer_master: 70 } }, [bp("OTC", "Order to cash")]);
    renderWithQuery(<ProcessInsightsPage />);
    expect(await screen.findByText("Order to cash step")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("v2", "sd_customer_master");
    expect(read).not.toHaveBeenCalledWith("v2", "accounts_payable");
  });

  it("says the run has no object of the named L1 instead of showing another L1", async () => {
    nav.qs = "l1=OTC&run=v3";
    setup({ id: "v3", label: "Run 3", status: "complete", run_at: "2026-01-03T00:00:00Z", dqs_summary: { accounts_payable: 80 } },
      [bp("PTP", "Procure to pay")]);
    renderWithQuery(<ProcessInsightsPage />);
    expect(await screen.findByText("No OTC object in this run")).toBeInTheDocument();
    expect(screen.queryByText("Procure to pay step")).toBeNull();
    expect(screen.getByRole("button", { name: "Show Procure to pay" })).toBeInTheDocument();
  });
});
