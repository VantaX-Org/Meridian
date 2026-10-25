// frontend/app/(app)/objects/[object]/__tests__/records-to-fix.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as rulesApi from "@/lib/api/rules";
import * as fieldProfileApi from "@/lib/api/field-profile";
import * as workApi from "@/lib/api/work";
import type { Version } from "@/types/api";
import ObjectDetailPage from "../page";

let searchParams = new URLSearchParams("run=v1");
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));
let canAnalyse = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => (a === "analyse" ? canAnalyse : true) }) }));

const VERSION: Version = {
  id: "v1", label: "Oct 8", status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
  metadata: { modules: ["material_master"] },
};
const OBJECT: objectsApi.ObjectDetail = {
  module: "material_master", label: "Material master", composite_score: 72.5, readiness: "warn", failing_checks: 1, affected_records: 120,
  dimension_scores: { completeness: 80 },
  rules: [{ check_id: "mm_missing_desc", severity: "high", dimension: "completeness", affected_count: 42, total_count: 100, pass_rate: 0.58 }],
};
const SUMMARY: workApi.WorkSummary = {
  version_id: "v1", scope: "s", built: true,
  objects: [{ module: "material_master", records: 3, open: 3, issues: 4, critical: 1, proposed: 2, overdue: 0, statuses: { to_fix: 3 } }],
  totals: { records: 3, open: 3, issues: 4, critical: 1, proposed: 2, overdue: 0 },
};
const rec = (key: string, extra: Partial<workApi.WorkRecord> = {}): workApi.WorkRecord => ({
  module: "material_master", record_key: key, name: null, issues: 1, severity: "high", checks: ["mm_missing_desc"], proposed: 0,
  status: "to_fix", due_at: null, assigned_to: null, assignee_email: null, top_message: "Description is missing", top_field: "MAKT.MAKTX", ...extra,
});
const detail = (key: string, status: workApi.WorkStatus = "to_fix"): workApi.WorkRecordDetail => ({
  version_id: "v1", module: "material_master", record_key: key, name: null, status, assigned_to: null, assignee_email: null, values: {},
  issues: [{
    check_id: "mm_missing_desc", severity: "high", dimension: "completeness", message: "Description is missing", field: "MAKT.MAKTX",
    current_value: "", instruction: null, why_it_matters: null, sap_impact: null,
    suggestion: { value: "Steel bolt", source: "rule", confidence: "high", why: null }, status, issue_id: "i1", resolution: null,
    first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null,
  }],
  events: [],
  can: { fix: true, sign_off: true, assign: true, comment: true },
});

beforeEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams("run=v1");
  push.mockClear();
  replace.mockClear();
  canAnalyse = true;
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [VERSION], total: 1 });
  vi.spyOn(versionsApi, "getVersion").mockResolvedValue(VERSION);
  vi.spyOn(objectsApi, "getObject").mockResolvedValue(OBJECT);
  vi.spyOn(rulesApi, "getRuleHistoryBatch").mockResolvedValue({ version_id: "v1", module: "material_master", history: {} });
  vi.spyOn(fieldProfileApi, "getProfileByVersion").mockResolvedValue({ version_id: "v1", object: "material_master", objects: [], tables: [], dependencies: [] });
  vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue({ version_id: "v1", check_id: "mm_missing_desc", total: 0, records: [] });
  vi.spyOn(workApi, "getWorkSummary").mockResolvedValue(SUMMARY);
  vi.spyOn(workApi, "getWorkGroups").mockResolvedValue({
    version_id: "v1", built: true, total: 1,
    groups: [{ check_id: "mm_missing_desc", module: "material_master", severity: "high", dimension: "completeness", message: "Description is missing", field: "MAKT.MAKTX", records: 3, population: 100, proposed: 2, truncated: false, statuses: { to_fix: 3 }, open: 3 }],
  });
  vi.spyOn(workApi, "getWorkRecords").mockResolvedValue({
    version_id: "v1", total: 3, total_capped: false, next: null,
    items: [rec("MATNR=1", { name: "Steel bolt", severity: "critical", proposed: 1 }), rec("MATNR=2"), rec("MATNR=3")],
  });
  vi.spyOn(workApi, "getWorkRecord").mockImplementation(async (_m, key) => detail(key));
});

describe("Records to fix", () => {
  it("is the default tab: the purpose line, the summary strip, the failing records worst first and the first record's fix panel", async () => {
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByRole("tab", { name: /Records to fix/, selected: true })).toBeInTheDocument();
    expect(screen.getByText("Records of Material master that fail a check in this run, worst first. Pick one and fix it.")).toBeInTheDocument();
    const strip = screen.getByTestId("fix-strip");
    for (const label of ["DQS", "Records failing", "Critical", "With a suggestion"]) expect(within(strip).getByText(label)).toBeInTheDocument();
    const rows = await screen.findAllByTestId("fix-row");
    expect(rows).toHaveLength(3);
    // A named record shows its name with the key under it; an unnamed one shows its key.
    expect(within(rows[0]).getByText("Steel bolt")).toBeInTheDocument();
    expect(within(rows[0]).getByText("MATNR=1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("MATNR=2")).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(workApi.getWorkRecords).toHaveBeenCalledWith({ version_id: "v1", module: "material_master", status: "open", after: undefined,
      check_id: undefined, severity: undefined, assigned: undefined, proposed: undefined, due: undefined, q: undefined });
    expect(screen.getByText("3 of 3 records")).toBeInTheDocument();
    expect(await screen.findByTestId("record-panel")).toBeInTheDocument();
    expect(workApi.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=1", "v1");
  });

  it("selects a record into the URL; ?record= opens that record's panel", async () => {
    searchParams = new URLSearchParams("run=v1&record=MATNR%3D2");
    renderWithQuery(<ObjectDetailPage />);
    const rows = await screen.findAllByTestId("fix-row");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(workApi.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=2", "v1"));
    fireEvent.click(rows[2]);
    expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1&record=MATNR%3D3", { scroll: false });
  });

  it("j / k and the arrow keys move through the records; Enter opens the full record", async () => {
    searchParams = new URLSearchParams("run=v1&record=MATNR%3D2");
    renderWithQuery(<ObjectDetailPage />);
    await screen.findAllByTestId("fix-row");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1&record=MATNR%3D3", { scroll: false });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1&record=MATNR%3D1", { scroll: false });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(push).toHaveBeenLastCalledWith("/objects/material_master/records/MATNR%3D2?run=v1");
    // Typing in the search box never moves the selection.
    replace.mockClear();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search records" }), { key: "j" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("loads the next page with the cursor", async () => {
    const records = vi.spyOn(workApi, "getWorkRecords")
      .mockResolvedValueOnce({ version_id: "v1", total: 4, total_capped: false, next: "c1", items: [rec("MATNR=1"), rec("MATNR=2")] })
      .mockResolvedValueOnce({ version_id: "v1", total: 4, total_capped: false, next: null, items: [rec("MATNR=3"), rec("MATNR=4")] });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("fix-row")).toHaveLength(4));
    expect(records).toHaveBeenLastCalledWith(expect.objectContaining({ after: "c1", module: "material_master" }));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says 100,000+ when the server stopped counting", async () => {
    vi.spyOn(workApi, "getWorkRecords").mockResolvedValue({ version_id: "v1", total: 100_000, total_capped: true, next: "c1", items: [rec("MATNR=1")] });
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("1 of 100,000+ records")).toBeInTheDocument();
  });

  it("reads its filters from the URL and writes them back, clearing the selection", async () => {
    searchParams = new URLSearchParams("run=v1&sev=critical&suggested=1&mine=1&record=MATNR%3D1");
    renderWithQuery(<ObjectDetailPage />);
    await screen.findAllByTestId("fix-row");
    expect(workApi.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical", proposed: true, assigned: "me", status: "open" }));
    expect(screen.getByRole("button", { name: "Has a suggestion", pressed: true })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Severity" })).getByRole("button", { name: "High" }));
    expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1&sev=high&suggested=1&mine=1", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
    expect(replace.mock.calls.at(-1)?.[0]).toContain("due=overdue");
  });

  it("offers to clear the filters when none match, and says every record passes when nothing fails", async () => {
    vi.spyOn(workApi, "getWorkRecords").mockResolvedValue({ version_id: "v1", total: 0, total_capped: false, next: null, items: [] });
    searchParams = new URLSearchParams("run=v1&sev=critical");
    const a = renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("No records match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1", { scroll: false });
    a.unmount();
    searchParams = new URLSearchParams("run=v1");
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("Every record passes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open rules" })).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules");
  });

  it("offers to build the work list for a run without one, only to users who can analyse", async () => {
    vi.spyOn(workApi, "getWorkSummary").mockResolvedValue({ ...SUMMARY, built: false, objects: [] });
    const build = vi.spyOn(workApi, "buildWorklist").mockResolvedValue({ version_id: "v1", queued: true });
    const a = renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("The work list for this run is not built yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build the work list" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith("v1"));
    expect(await screen.findByText(/Building now/)).toBeInTheDocument();
    expect(workApi.getWorkRecords).not.toHaveBeenCalled();
    a.unmount();
    canAnalyse = false;
    renderWithQuery(<ObjectDetailPage />);
    expect(await screen.findByText("The work list for this run is not built yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Build the work list" })).toBeNull();
  });

  it("after a decision that leaves nothing to fix on the record, moves to the next record", async () => {
    let decided = false;
    vi.spyOn(workApi, "getWorkRecord").mockImplementation(async (_m, key) => detail(key, decided && key === "MATNR=1" ? "proposed" : "to_fix"));
    const decide = vi.spyOn(workApi, "decide").mockImplementation(async () => { decided = true; return { updated: 1, draft_batch_id: "b1" }; });
    renderWithQuery(<ObjectDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: 'Accept "Steel bolt"' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith([{ module: "material_master", record_key: "MATNR=1", check_id: "mm_missing_desc", action: "accept" }], "v1"));
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/objects/material_master?run=v1&record=MATNR%3D2", { scroll: false }));
  });
});
