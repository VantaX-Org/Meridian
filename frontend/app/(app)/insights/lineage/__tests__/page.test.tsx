import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as lineageApi from "@/lib/api/lineage";
import * as miningApi from "@/lib/api/mining";
import * as learnedRulesApi from "@/lib/api/learnedRules";
import * as versionsApi from "@/lib/api/versions";
import LineagePage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
// DayOneAction renders its fallback link, as it does with no day-one step.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: ({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) => <a href={fallbackHref}>{fallbackLabel}</a>,
}));

const LATEST = {
  id: "v1", label: "Run 1", status: "complete", run_at: "2026-01-01T00:00:00Z",
  dqs_summary: { material_master: 90 },
};

// The Relationships card reads the mined feed; most tests here are about the trace, so it answers empty.
beforeEach(() => { vi.spyOn(miningApi, "getMiningRelationships").mockResolvedValue([]); });

describe("LineagePage relationships", () => {
  const setup = () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({ model_version: 1, node_counts: {}, edge_count: 0, kpis: [], processes: [], features: [], warnings: [] });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({ version_id: "v1", model_version: 1, cost_available: false, kpis: [], processes: [], features: [], unmapped_checks: [] });
  };

  it("lists the mined field relationships of the latest run, moved from Duplicates", async () => {
    setup();
    const get = vi.spyOn(miningApi, "getMiningRelationships").mockResolvedValue([
      { id: "r1", version_id: "v1", module_id: "material_master", field_a: "MTART", field_b: "BKLAS", relationship_type: "dependency", strength_score: 0.9, detected_at: "2026-10-01T00:00:00Z" },
    ]);
    renderWithQuery(<LineagePage />);
    expect(await screen.findByText("BKLAS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Relationships" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith({ version_id: "v1", limit: 500 });
  });

  it("starts the relationship miner from its empty state", async () => {
    setup();
    const houseRules = vi.spyOn(learnedRulesApi, "mineLearnedRules").mockResolvedValue({ queued: true });
    const mine = vi.spyOn(miningApi, "runMining").mockResolvedValue({ task_id: "t1", version_id: "v1", include: ["relationship"] });
    renderWithQuery(<LineagePage />);
    expect(await screen.findByText("No field relationships found yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search now" }));
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v1", ["relationship"]));
    expect(houseRules).not.toHaveBeenCalled();
  });
});

describe("LineagePage", () => {
  it("renders the model summary and impact rows", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({
      model_version: 3, node_counts: {}, edge_count: 120, kpis: [], processes: [], features: [], warnings: [],
    });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 3, cost_available: false,
      kpis: [{ id: "kpi:dpo", type: "kpi", label: "DPO", findings: 2, check_ids: ["AP017"], records_affected: 40, max_records: 30, worst_severity: "high", worst_impact: "degraded", min_hops: 2 }],
      processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "LFB1.ZTERM", model_version: 3, nodes: [], edges: [], paths_to_kpis: [],
    });
    renderWithQuery(<LineagePage />);
    await waitFor(() => expect(lineageApi.getLineageImpact).toHaveBeenCalled());
  });

  it("shows an empty state when the model has no linked nodes for the trace", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({
      model_version: 1, node_counts: {}, edge_count: 0, kpis: [], processes: [], features: [], warnings: [],
    });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 1, cost_available: false, kpis: [], processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "LFB1.ZTERM", model_version: 1, nodes: [], edges: [], paths_to_kpis: [],
    });
    renderWithQuery(<LineagePage />);
    await screen.findByText(/Enter a field, rule or KPI to trace/i);
    expect(lineageApi.getLineage).not.toHaveBeenCalled();
  });

  it("shows the API error message for the lineage model and retries on click", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockRejectedValue({ isAxiosError: true, response: { data: { detail: "lineage model service unavailable" } } });
    renderWithQuery(<LineagePage />);
    await screen.findByText("lineage model service unavailable");
    const calls = (lineageApi.getLineageModel as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((lineageApi.getLineageModel as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});

describe("LineagePage trace graph", () => {
  it("draws the trace as a group of focusable nodes and links an object node to /objects/<object>", async () => {
    // The chart measures its box with ResizeObserver, which jsdom lacks.
    class StubRO { observe() {} disconnect() {} unobserve() {} }
    vi.stubGlobal("ResizeObserver", StubRO);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({ model_version: 3, node_counts: {}, edge_count: 10, kpis: [], processes: [], features: [], warnings: [] });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 3, cost_available: false,
      kpis: [{ id: "kpi:dpo", type: "kpi", label: "DPO", findings: 2, check_ids: ["AP017"], records_affected: 40, max_records: 30, worst_severity: "high", worst_impact: "degraded", min_hops: 2 }],
      processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "kpi:dpo", model_version: 3,
      nodes: [
        { id: "kpi:dpo", type: "kpi", label: "DPO" },
        { id: "object:business_partner", type: "object", label: "Business partner" },
      ],
      edges: [{ source: "object:business_partner", target: "kpi:dpo", rel: "feeds_into" }],
      paths_to_kpis: [],
    } as never);
    const { container } = renderWithQuery(<LineagePage />);
    const svg = await waitFor(() => {
      const el = container.querySelector("svg[aria-label='Lineage trace']");
      expect(el).not.toBeNull();
      return el as SVGSVGElement;
    });
    // Focusable nodes inside an svg make role=img invalid (axe nested-interactive); the svg is a group.
    expect(svg).toHaveAttribute("role", "group");
    // Each node is a focusable button whose <title> names it (the hover tooltip and the accessible name).
    const node = await waitFor(() => {
      const g = Array.from(container.querySelectorAll("g.m-graph-node")).find((el) => el.querySelector("title")?.textContent === "Business partner");
      expect(g).toBeTruthy();
      return g as SVGGElement;
    });
    expect(node).toHaveAttribute("role", "button");
    expect(node).toHaveAttribute("tabindex", "0");
    // The frame carries the shared action bar for the run (checked before the drawer, a modal, hides the page).
    fireEvent.click(node);
    const open = await screen.findByRole("link", { name: "Open the object" });
    expect(open).toHaveAttribute("href", "/objects/business_partner?run=v1");
    expect(open.getAttribute("href")).not.toContain("/analyse/");
    vi.unstubAllGlobals();
  });
});

describe("LineagePage blast radius", () => {
  it("sends a traced rule to Runs when there is no completed analysis", async () => {
    class StubRO { observe() {} disconnect() {} unobserve() {} }
    vi.stubGlobal("ResizeObserver", StubRO);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({ model_version: 3, node_counts: {}, edge_count: 10, kpis: [], processes: [], features: [], warnings: [] });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "check:AP017", model_version: 3,
      nodes: [
        { id: "check:AP017", type: "check", label: "AP017" },
        { id: "kpi:dpo", type: "kpi", label: "DPO" },
      ],
      edges: [{ source: "check:AP017", target: "kpi:dpo", rel: "guards" }],
      paths_to_kpis: [],
    } as never);
    const { container } = renderWithQuery(<LineagePage />);
    fireEvent.change(await screen.findByLabelText("Item to trace"), { target: { value: "check:AP017" } });
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    const node = await waitFor(() => {
      const g = Array.from(container.querySelectorAll("g.m-graph-node")).find((el) => el.querySelector("title")?.textContent === "AP017");
      expect(g).toBeTruthy();
      return g as SVGGElement;
    });
    fireEvent.click(node);
    const empty = (await screen.findByText("Nothing to follow yet")).closest("[data-state='empty']") as HTMLElement;
    expect(within(empty).getByText("Following a rule to what it reaches needs a completed analysis.")).toBeInTheDocument();
    expect(within(empty).getByRole("link", { name: "Open runs" })).toHaveAttribute("href", "/runs");
    vi.unstubAllGlobals();
  });

  it("names the object a rule reaches by its lineage name, never its id", async () => {
    class StubRO { observe() {} disconnect() {} unobserve() {} }
    vi.stubGlobal("ResizeObserver", StubRO);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({ model_version: 3, node_counts: {}, edge_count: 10, kpis: [], processes: [], features: [], warnings: [] });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({
      start: "check:AP017", model_version: 3,
      nodes: [
        { id: "check:AP017", type: "check", label: "AP017" },
        { id: "object:gl_account", type: "object", label: "G/L account" },
      ],
      edges: [{ source: "check:AP017", target: "object:gl_account", rel: "guards" }],
      paths_to_kpis: [],
    } as never);
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 3, cost_available: false, kpis: [], processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getBlastRadius").mockResolvedValue({
      version_id: "v1", check_id: "AP017", grain: "SKA1", object: "gl_account", failing_records: 4, keys_truncated: false,
      targets: [], steps_touched: [], processes_touched: [],
    });
    const { container } = renderWithQuery(<LineagePage />);
    fireEvent.change(await screen.findByLabelText("Item to trace"), { target: { value: "check:AP017" } });
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    const node = await waitFor(() => {
      const g = Array.from(container.querySelectorAll("g.m-graph-node")).find((el) => el.querySelector("title")?.textContent === "AP017");
      expect(g).toBeTruthy();
      return g as SVGGElement;
    });
    fireEvent.click(node);

    expect(await screen.findByText(/4 failing records on G\/L account touch 0 processes/)).toBeInTheDocument();
    expect(screen.queryByText(/on gl_account/)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps Trace it as the one primary; the form's Trace is secondary", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(lineageApi, "getLineageModel").mockResolvedValue({
      model_version: 3, node_counts: {}, edge_count: 120, kpis: [], processes: [], features: [], warnings: [],
    });
    vi.spyOn(lineageApi, "getLineageImpact").mockResolvedValue({
      version_id: "v1", model_version: 3, cost_available: false,
      kpis: [{ id: "kpi:dpo", type: "kpi", label: "DPO", findings: 2, check_ids: ["AP017"], records_affected: 40, max_records: 30, worst_severity: "high", worst_impact: "degraded", min_hops: 2 }],
      processes: [], features: [], unmapped_checks: [],
    });
    vi.spyOn(lineageApi, "getLineage").mockResolvedValue({ start: "kpi:dpo", model_version: 3, nodes: [], edges: [], paths_to_kpis: [] });
    renderWithQuery(<LineagePage />);
    expect(await screen.findByRole("button", { name: "Trace it" })).toHaveClass("m-btn-primary");
    const form = (await screen.findByLabelText("Item to trace")).closest("form") as HTMLElement;
    expect(within(form).getByRole("button", { name: "Trace" })).toHaveClass("m-btn-secondary");
  });

});
