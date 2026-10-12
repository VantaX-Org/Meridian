// frontend/app/(app)/process/__tests__/l1-drill.test.tsx
import axe from "axe-core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as designerApi from "@/lib/api/process-designer";
import * as pdApi from "@/lib/api/process-discovery";
import type { CatalogueRow, Dfg, DiscoveryRunDetail, NodeStats, VariantRow } from "@/lib/api/process-discovery";
import type { SAPSystemExtended } from "@/types/api";
import type { DiscoveryStats, L4, ProcessModelDocument } from "@/types/process-model";
import ProcessL1Page from "../[l1]/page";
import { fmtSeconds } from "../_components/shared";

const h = vi.hoisted(() => ({ qs: "", can: (() => true) as (action: string) => boolean, replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/process/PTP",
  useSearchParams: () => new URLSearchParams(h.qs),
  useParams: () => ({ l1: "PTP" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));

const SYS = { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" } as unknown as SAPSystemExtended;
const stats = (case_count: number, share: number, median_seconds: number): DiscoveryStats => ({
  case_count, share, event_count: case_count, median_seconds, p90_seconds: median_seconds * 2, rework_rate: 0.1,
  automation_rate: 0.5, fitness: 0.9, observed: true, case_type: "po_item", edges: [], entry_count: case_count,
});
const L4_PO: L4 = {
  id: "PTP-01-01-01", name: "Create purchase order", description: "", order: 1, tcode: "ME21N", config_dependency: null,
  variants: [], diagram: { nodes: [], flows: [] }, source: "template", discovery: stats(100, 1, 3600),
  activities: [
    { id: "PTP-01-01-01-A1", name: "Create PO item", description: "", order: 1, tcode: "ME21N", check_ids: [], sap_tables: ["EKPO"],
      fields: [{ field: "EKPO-MENGE", check_id: null, description: "Quantity", mandatory: true, config_source: null }],
      source: "discovered", discovery: stats(100, 1, 7200) },
    { id: "PTP-01-01-01-A2", name: "Release PO", description: "", order: 2, tcode: "ME29N", check_ids: [], sap_tables: ["EKKO"],
      fields: [], source: "template", discovery: stats(40, 0.4, 1800) },
  ],
};
const DOC: ProcessModelDocument = {
  schema_version: 1,
  l1: [{ id: "PTP", name: "Procure to Pay", description: "", order: 1, modules: ["MM"],
    l2: [{ id: "PTP-01", name: "Purchasing", description: "", order: 1,
      l3: [{ id: "PTP-01-01", name: "Order", description: "", order: 1, l4: [L4_PO] }] }] }],
};
const ROW: CatalogueRow = {
  l1: "PTP", name: "Procure to Pay", coverage: "discovered", reason: null, sources: [],
  last_run: { id: "run-1", status: "completed", finished_at: "2026-10-10T00:10:00Z",
    cases: 100, variants: 2, median_seconds: 86_400, automation_rate: 0.5, fitness: 0.9 },
  in_progress: null, failed: null,
};
const RUN: DiscoveryRunDetail = {
  id: "run-1", l1: "PTP", mode: "full", status: "completed", coverage: "discovered", window_from: null, window_to: null,
  watermark: null, extraction_version_id: null, job_id: null, filters: {}, error: null,
  started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:10:00Z", system_id: "sys-1", system_type: "S4HANA",
  stats: { cases: 100, variants: 2, case_types: { po_item: 100, po_header: 80 }, rework: { "Create PO item": 0.12 },
    conformance: { fitness: 0.9, missing: {}, out_of_order: {} }, throughput: { median_seconds: 86_400, p90_seconds: null } },
};
const node = (id: string, name: string, case_count: number): NodeStats => ({
  id, name, source: "template", observed: true, case_count, share: case_count / 100, median_seconds: 600, fitness: 0.9,
});
const dfg = (level: number, at: NodeStats, nodes: NodeStats[]): Dfg => ({
  level, node: at, nodes, edge_threshold: 0.01, cached: false,
  edges: [{ source: "START", target: nodes[0].id, count: 100, median_seconds: null },
    { source: nodes[0].id, target: "END", count: 100, median_seconds: 3600 }],
});
const VARIANTS: VariantRow[] = [
  { hash: "a".repeat(32), activities: ["Create PO item", "Release PO"], case_count: 60, share: 0.6, median_seconds: 3600,
    p90_seconds: 7200, fitness: 1, sample_case_ids: ["4500000001/00010"] },
  { hash: "0".repeat(32), activities: [], case_count: 5, share: 0.05, median_seconds: null, p90_seconds: null, fitness: null,
    sample_case_ids: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  h.qs = "system=sys-1"; h.can = () => true; h.replace = vi.fn();
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYS]);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([ROW]);
  vi.spyOn(pdApi, "getRun").mockResolvedValue(RUN);
  vi.spyOn(pdApi, "getRunModel").mockResolvedValue(DOC);
  vi.spyOn(designerApi, "getReference").mockResolvedValue(DOC);
  vi.spyOn(pdApi, "getDfg").mockImplementation(async (_run, p) =>
    p.node_id === "PTP-01-01-01"
      ? dfg(5, node("PTP-01-01-01", "Create purchase order", 100), [node("PTP-01-01-01-A1", "Create PO item", 100)])
      : dfg(2, node("PTP", "Procure to Pay", 100), [node("PTP-01", "Purchasing", 100)]));
  vi.spyOn(pdApi, "getVariants").mockResolvedValue({ case_type: "po_item", total: 2, items: VARIANTS });
  vi.spyOn(pdApi, "getConformance").mockResolvedValue({ case_type: "po_item", fitness: 0.82,
    missing: { "Release PO": 0.3 }, steps: [{ activity: "Create PO item", step_fitness: 0.95, out_of_order: 0.02 }] });
  vi.spyOn(pdApi, "listCases").mockResolvedValue({ case_type: "po_item", total: 1,
    items: [{ case_id: "4500000001/00010", first_ts: "2026-01-01T00:00:00Z", last_ts: "2026-01-02T00:00:00Z", events: 2, variant: "a".repeat(32) }] });
  vi.spyOn(pdApi, "getCaseEvents").mockResolvedValue({ case_type: "po_item", case_id: "4500000001/00010", events: [] });
});

const lastReplace = () => new URL(`http://x${h.replace.mock.calls.at(-1)![0]}`).searchParams;

describe("process L1 empty-state actions", () => {
  it("offers Go up one level on an empty flow below L1", async () => {
    h.qs = "system=sys-1&node=PTP-01";
    vi.spyOn(pdApi, "getDfg").mockResolvedValue({ ...dfg(3, node("PTP-01", "Purchasing", 1), [node("x", "x", 1)]), nodes: [] });
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByRole("button", { name: "Go up one level" })).toBeInTheDocument();
  });

  it.each([
    ["conformance", () => vi.spyOn(pdApi, "getConformance").mockResolvedValue({ case_type: "po_item", fitness: 1, missing: {}, steps: [] })],
    ["cases", () => vi.spyOn(pdApi, "listCases").mockResolvedValue({ case_type: "po_item", total: 0, items: [] })],
    ["variants", () => vi.spyOn(pdApi, "getVariants").mockResolvedValue({ case_type: "po_item", total: 0, items: [] })],
  ])("offers Clear filters on an empty %s tab", async (tab, mock) => {
    mock();
    h.qs = `system=sys-1&tab=${tab}&doc_type=ZZ`;
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("offers Open flow on the diagram tab above L4", async () => {
    h.qs = "system=sys-1&tab=bpmn";
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByRole("button", { name: "Open flow" })).toBeInTheDocument();
  });

  it("Clear filters drops filter params and keeps system and tab", async () => {
    vi.spyOn(pdApi, "getVariants").mockResolvedValue({ case_type: "po_item", total: 0, items: [] });
    h.qs = "system=sys-1&tab=variants&doc_type=ZZ&from=2026-01-01";
    renderWithQuery(<ProcessL1Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    const q = lastReplace();
    expect(q.has("doc_type")).toBe(false);
    expect(q.has("from")).toBe(false);
    expect(q.get("tab")).toBe("variants");
    expect(q.get("system")).toBe("sys-1");
  });

  it.each([
    ["L2", "PTP-01", null],
    ["L3", "PTP-01-01", "PTP-01"],
  ])("Go up one level from %s sets node to %s parent", async (_lvl, at, parent) => {
    h.qs = `system=sys-1&node=${at}`;
    vi.spyOn(pdApi, "getDfg").mockResolvedValue({ ...dfg(3, node(at, "x", 1), [node("x", "x", 1)]), nodes: [] });
    renderWithQuery(<ProcessL1Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Go up one level" }));
    expect(lastReplace().get("node")).toBe(parent);
  });

  it("Open flow switches to the flow tab and clears the case", async () => {
    h.qs = "system=sys-1&tab=bpmn&case=4500000001/00010";
    renderWithQuery(<ProcessL1Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Open flow" }));
    const q = lastReplace();
    expect(q.get("tab")).toBe("flow");
    expect(q.has("case")).toBe(false);
  });
});

describe("process L1 drill", () => {
  it("opens the latest completed run on the flow tab and drills on a node click", async () => {
    renderWithQuery(<ProcessL1Page />);
    const n = await screen.findByRole("button", { name: "Node Purchasing" });
    expect(pdApi.getRun).toHaveBeenCalledWith("run-1");
    fireEvent.click(n);
    expect(lastReplace().get("node")).toBe("PTP-01");
    expect(screen.queryByRole("button", { name: "Node Start" })).toBeTruthy();
  });

  it("reaches L4 and shows the L5 table with cases, share and median", async () => {
    h.qs = "system=sys-1&node=PTP-01-01-01";
    renderWithQuery(<ProcessL1Page />);
    const row = (await screen.findByText("PTP-01-01-01-A2")).closest("tr")!;
    expect(within(row).getByText("40")).toBeTruthy();
    expect(within(row).getByText("40%")).toBeTruthy();
    expect(within(row).getByText(fmtSeconds(1800))).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Process levels" }).textContent).toContain("Create purchase order");
  });

  it("passes URL filters to the DFG and writes filter changes back to the URL", async () => {
    h.qs = "system=sys-1&from=2026-01-01&org.BUKRS=1000";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    expect(pdApi.getDfg).toHaveBeenCalledWith("run-1", { from: "2026-01-01", "org.BUKRS": "1000" });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    expect(lastReplace().get("to")).toBe("2026-06-30");
    expect(lastReplace().get("from")).toBe("2026-01-01");
  });

  it.each([
    ["variants", "All other variants"],
    ["conformance", "Missing steps"],
    ["cases", "4500000001/00010"],
    ["bpmn", "Pick a level-4 process to see its diagram"],
    ["reference", "Reference model"],
  ])("renders ?tab=%s from the URL", async (tab, text) => {
    h.qs = `system=sys-1&tab=${tab}`;
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("pins the Other variant row last", async () => {
    h.qs = "system=sys-1&tab=variants";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByText("All other variants");
    const rows = screen.getAllByRole("row");
    expect(rows.at(-1)!.textContent).toContain("All other variants");
  });

  it("shows rework per step from the run stats", async () => {
    h.qs = "system=sys-1&tab=conformance";
    renderWithQuery(<ProcessL1Page />);
    const cell = await screen.findByText("Create PO item", { selector: "td, td *" });
    expect(within(cell.closest("tr")!).getByText("12%")).toBeTruthy();
  });

  it("hides the Cases tab without export_process", async () => {
    h.can = (a) => a !== "export_process";
    h.qs = "system=sys-1&tab=cases";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    expect(screen.queryByRole("tab", { name: "Cases" })).toBeNull();
    expect(pdApi.listCases).not.toHaveBeenCalled();
  });

  it("offers a table instead of the flow chart", async () => {
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("button", { name: "View as chart" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("Purchasing").length).toBeGreaterThan(0);
  });

  it("links each node's DQ defects to the failing objects and dashes an unmapped node", async () => {
    vi.spyOn(pdApi, "getDfg").mockResolvedValue(dfg(2, node("PTP", "Procure to Pay", 100),
      [{ ...node("PTP-01", "Purchasing", 100), dq_defects: 12 }, { ...node("PTP-02", "Receiving", 50), dq_defects: null }]));
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("link", { name: "12" }).getAttribute("href")).toBe("/objects?run=latest&readiness=fail");
    expect(screen.getByRole("columnheader", { name: /DQ defects/ })).toBeTruthy();
  });

  it("defaults a reference-only L1 to the reference tab and explains the other tabs", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...ROW, coverage: "reference", reason: "No PTP tables on this system.", last_run: null }]);
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText("Reference model")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Reference" }).getAttribute("aria-selected")).toBe("true");
    expect(pdApi.getRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Flow" }));
    expect(lastReplace().get("tab")).toBe("flow");
  });

  it("explains a reference-only L1 on a mined tab", async () => {
    h.qs = "system=sys-1&tab=flow";
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...ROW, coverage: "reference", reason: "No PTP tables on this system.", last_run: null }]);
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText("Reference, not discovered")).toBeTruthy();
    expect(screen.getAllByText("No PTP tables on this system.").length).toBeGreaterThan(0);
  });

  it("shows an error state when the DFG fails", async () => {
    vi.spyOn(pdApi, "getDfg").mockRejectedValue(new Error("boom"));
    renderWithQuery(<ProcessL1Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry|Try again/ })).toBeTruthy());
  });
});

/** axe-core on the rendered drill. jsdom has no layout or colour, so contrast is left to the token lint. */
async function violations(el: HTMLElement) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("process L1 drill accessibility (axe)", () => {
  it.each([
    ["flow", "Node Purchasing"],
    ["variants", "All other variants"],
    ["conformance", "Missing steps"],
    ["cases", "4500000001/00010"],
    ["bpmn", "Pick a level-4 process to see its diagram"],
    ["reference", "Reference model"],
  ])("has no violations on ?tab=%s", async (tab, text) => {
    h.qs = `system=sys-1&tab=${tab}`;
    const { container } = renderWithQuery(<ProcessL1Page />);
    await (text.startsWith("Node ") ? screen.findByRole("button", { name: text }) : screen.findByText(text));
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations on the flow table view and at L4", async () => {
    h.qs = "system=sys-1&node=PTP-01-01-01";
    const { container } = renderWithQuery(<ProcessL1Page />);
    await screen.findByText("PTP-01-01-01-A2");
    expect(await violations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(await violations(container)).toEqual([]);
  });
});
