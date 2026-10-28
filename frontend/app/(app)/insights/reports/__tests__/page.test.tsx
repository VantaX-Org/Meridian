import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auditApi from "@/lib/api/audit";
import * as downloadApi from "@/lib/api/download";
import * as insightsApi from "@/lib/api/insights";
import * as reportsApi from "@/lib/api/reports";
import * as versionsApi from "@/lib/api/versions";
import { reportFilename } from "@/lib/report-filename";
import ReportsPage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const perm = vi.hoisted(() => ({ allowed: true, only: "" }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => perm.allowed, has: (r: string, a: string) => (perm.only ? perm.only === `${r}.${a}` : perm.allowed) }),
  usePermissionsContext: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/reports",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }), useSearchParams: () => new URLSearchParams("") }));

const entry = (id: string, name: string, url: string | null) => ({
  id, name, format: "PDF" as const, about: `${name} about`, sections: ["Cover", "Scores"], page_estimate: 4, requires: [], url, last_built_at: null,
});

function mount(kinds: string[] = ["board"], catalogue?: reportsApi.CatalogueEntry[]) {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
    { id: "v2", label: "Run 2", status: "complete", run_at: "2026-10-16T05:00:00Z", metadata: { modules: ["business_partner"] } },
    { id: "v1", label: "Run 1", status: "complete", run_at: "2026-10-02T05:00:00Z", metadata: { modules: ["business_partner"] } },
    { id: "co", label: "controlling_1k", status: "complete", run_at: "2026-10-03T05:00:00Z", metadata: { modules: ["controlling"] } },
  ] } as never);
  vi.spyOn(reportsApi, "getReportCatalogue").mockResolvedValue(catalogue ?? [entry("board", "Board pack", "/api/v1/reports/board/v2.pdf"), entry("compare", "Run comparison", "/api/v1/reports/compare/v2.pdf"), { ...entry("record", "Record fix sheet", null), requires: ["record"] }]);
  vi.spyOn(insightsApi, "getOverview").mockResolvedValue({
    version_id: "v2", run_label: "Run 2", run_at: null, previous_version_id: null,
    dqs: { composite: 80, previous: null, delta: null, tier: "go", capped: false, cap_reason: null },
    blockers: { count: 2, previous: null, waves: 1 }, auto_fixable: { records: 0, failing_records: 0, pct: null, high_confidence: 0 },
    value_at_risk: { worst_l1: null, worst_l1_amount: 0, currency: "USD", features_blocked: 0 }, narrative: [],
  });
  vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ total: kinds.length, limit: 5, offset: 0, entries: kinds.map((kind, i) => ({ id: `a${i + 1}`, actor_user_id: null, actor_email: "ana@example.test", action: "report.export", entity_type: "report", entity_id: "v2", method: "GET", path: "/x", status_code: 200, ip: null, user_agent: null, before_json: null, after_json: { kind }, created_at: "2026-10-12T10:00:00Z" })) });
  vi.spyOn(insightsApi, "getHeatmap").mockResolvedValue({ version_id: "v2", dimensions: [], rows: [] });
  vi.spyOn(reportsApi, "getReportHistory").mockResolvedValue({ total: 0, limit: 10, offset: 0, items: [] });
  vi.spyOn(reportsApi, "getReportSchedules").mockResolvedValue([]);
  vi.spyOn(reportsApi, "getReportScheduleOptions").mockResolvedValue({ timezone: "UTC", types: [], users: [], channels: [], systems: [], modules: [] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ReportsPage /></QueryClientProvider>);
}

afterEach(() => { vi.restoreAllMocks(); perm.only = ""; });

describe("ReportsPage", () => {
  it("lists the recent export audit events", async () => {
    perm.allowed = true;
    mount();
    expect(await screen.findByText(/Board pack by ana@example.test/)).toBeInTheDocument();
  });

  it("names each recent export by the library's report name, never its raw kind", async () => {
    perm.allowed = true;
    mount(["workbook", "full", "data_contract"]);
    expect(await screen.findByText(/Comparison workbook by ana/)).toBeInTheDocument();
    expect(screen.getByText(/Narrative report by ana/)).toBeInTheDocument();
    expect(screen.getByText(/Data contract by ana/)).toBeInTheDocument();
    expect(screen.queryByText(/: workbook by|: full by/)).toBeNull();
  });

  it.each(["audit.view", "users.admin"])("shows recent exports to a viewer with only %s and no export permission", async (only) => {
    perm.allowed = false;
    perm.only = only;
    mount();
    expect(await screen.findByText(/Board pack by ana@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Reports" })).toBeNull();
  });

  it("hides recent exports and skips the audit query without audit access", async () => {
    perm.allowed = false;
    perm.only = "none.none";
    mount();
    await screen.findAllByText(/needs the auditor or analyst role/i);
    expect(screen.queryByText("Recent exports")).toBeNull();
    expect(auditApi.getAuditEntries).not.toHaveBeenCalled();
  });

  it("lists reports in a listbox, previews one and downloads it", async () => {
    perm.allowed = true;
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    mount();
    expect(await screen.findByRole("listbox", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: /Comparison report/ }));
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.getByText(/Key figures: DQS 80/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    // Named by the report, the run and the day, never the run id.
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/compare/v2.pdf", reportFilename({ name: "Comparison report", ext: "pdf" }, "Run 2"));
    expect(dl.mock.calls[0][1]).toMatch(/^Meridian comparison report – Run 2 – \d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("lists all seven server reports (extraction, trend, rules, dictionary, owners, board, workbook), each downloadable", async () => {
    perm.allowed = true;
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    const seven = [
      entry("extraction", "Extraction report", "/api/v1/reports/extraction/v2.pdf"),
      entry("trend", "Trend report", "/api/v1/reports/trend.pdf"),
      entry("rules", "Rule catalogue", "/api/v1/reports/rules.pdf?module=business_partner"),
      entry("dictionary", "Data dictionary", "/api/v1/reports/dictionary.pdf"),
      entry("owners", "Owner workload", "/api/v1/reports/owners/v2.pdf"),
      entry("board", "Board pack", "/api/v1/reports/board/v2.pdf"),
      { ...entry("workbook", "Analyst workbook", "/api/v1/reports/v2/workbook.xlsx"), format: "XLSX" as const },
    ];
    mount(["board"], seven);
    const list = await screen.findByRole("listbox", { name: "Reports" });
    const names = ["Extraction report", "Progress report", "Rule catalogue", "Data dictionary", "Owner workload", "Board pack", "Comparison workbook"];
    for (const n of names) expect(await within(list).findByRole("option", { name: new RegExp(n) })).toBeInTheDocument();
    expect(within(list).getAllByRole("option")).toHaveLength(7);
    await userEvent.click(within(list).getByRole("option", { name: /Owner workload/ }));
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(dl.mock.calls[0][0]).toBe("/api/v1/reports/owners/v2.pdf");
  });

  it("moves the selection with the arrow keys", async () => {
    perm.allowed = true;
    mount();
    const first = await screen.findByRole("option", { name: /Board pack/ });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Comparison report/ })).toHaveAttribute("aria-selected", "true");
  });

  it("disables record download until a key is typed", async () => {
    perm.allowed = true;
    mount();
    await userEvent.click(await screen.findByRole("option", { name: /Record fix sheet/ }));
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    // The API's requires token reads as the step to take, not "Needs: record."
    expect(screen.getByText("Enter a record key")).toBeInTheDocument();
    expect(screen.queryByText(/Needs:/)).toBeNull();
    await userEvent.type(screen.getByLabelText("Record key"), "M1");
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("shows no library without the export permission", async () => {
    perm.allowed = false;
    mount();
    expect((await screen.findAllByText(/needs the auditor or analyst role/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("ReportsPage history and schedules", () => {
  it("shows the History and Schedules sections to a viewer who can export", async () => {
    perm.allowed = true;
    mount();
    expect(await screen.findByText("History")).toBeInTheDocument();
    expect(screen.getByText("Schedules")).toBeInTheDocument();
    expect(await screen.findByText(/No report has been kept yet/)).toBeInTheDocument();
  });

  it("refreshes the history after a library download", async () => {
    perm.allowed = true;
    vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    mount();
    await screen.findByRole("listbox", { name: "Reports" });
    const before = vi.mocked(reportsApi.getReportHistory).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => expect(vi.mocked(reportsApi.getReportHistory).mock.calls.length).toBeGreaterThan(before));
  });

  it("hides History and Schedules without the export permission", async () => {
    perm.allowed = false;
    mount();
    await screen.findAllByText(/needs the auditor or analyst role/i);
    expect(screen.queryByText("Schedules")).toBeNull();
    expect(reportsApi.getReportHistory).not.toHaveBeenCalled();
  });
});

describe("ReportsPage scope and rendering", () => {
  it("offers only runs of the same lineage under Compare with and writes the scope line from the run label", async () => {
    perm.allowed = true;
    mount();
    // The header names the run as every insight page does, then what the report covers.
    expect(await screen.findByTestId("insight-scope")).toHaveTextContent(/As of/);
    // Compare with defaults to the run before this one in its lineage, so the board pack states what changed.
    expect(await screen.findByText("compared with Run 1, every object in the run")).toBeInTheDocument();
    expect(reportsApi.getReportCatalogue).toHaveBeenLastCalledWith({ version_id: "v2", module: undefined, compare: "v1" });
    expect(screen.getByTestId("page-purpose")).toHaveTextContent(/Ready-made reports for the selected run/);
    await userEvent.click(screen.getByRole("combobox", { name: "Compare with" }));
    expect(await screen.findByRole("option", { name: "Run 1" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "controlling_1k" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Run 2" })).toBeNull();
    expect(screen.getByText("Comparing with Run 1.")).toBeInTheDocument();
  });

  it("shows a pending Rendering state on Download while the PDF builds", async () => {
    perm.allowed = true;
    let finish: () => void = () => {};
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockReturnValue(new Promise<void>((r) => { finish = r; }));
    mount();
    await screen.findByRole("listbox", { name: "Reports" });
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/board/v2.pdf", reportFilename("board", "Run 2"));
    // The preview's Download button and the header's next step both say what is happening.
    const pending = await screen.findAllByRole("button", { name: /Rendering/ });
    expect(pending.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish();
    expect(await screen.findByRole("button", { name: "Download" })).toBeEnabled();
  });
});
