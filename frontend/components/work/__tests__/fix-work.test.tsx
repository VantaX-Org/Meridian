// Fix work: the records that fail a check, worst first, and the decisions on them, by role.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../__tests__/render";
import { FixWork } from "../fix-work";
import { RecordPanel } from "../record-panel";
import { dueLabel } from "../status";
import * as work from "@/lib/api/work";
import * as versions from "@/lib/api/versions";

const replace = vi.fn();
const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/fix",
  useSearchParams: () => search,
}));
let perms = new Set(["apply", "approve", "assign", "analyse", "export"]);
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (p: string) => perms.has(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/api/work", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/work")>("@/lib/api/work");
  return {
    ...actual, getWorkSummary: vi.fn(), getWorkGroups: vi.fn(), getWorkRecords: vi.fn(), getWorkRecord: vi.fn(),
    decide: vi.fn(), acceptAllInGroup: vi.fn(), setGroupValue: vi.fn(), buildWorklist: vi.fn(), importFixSheet: vi.fn(),
    downloadFixSheet: vi.fn(),
  downloadFixSheetByObject: vi.fn(),
  };
});

const summary = (over: Partial<work.WorkSummary> = {}): work.WorkSummary => ({
  version_id: "R1", scope: "S1", built: true,
  objects: [{ module: "material_master", records: 2, open: 2, issues: 3, critical: 2, proposed: 1, overdue: 1, statuses: { to_fix: 2 } }],
  totals: { records: 2, open: 2, issues: 3, critical: 2, proposed: 1, overdue: 1 }, ...over,
});
const rec = (key: string, over: Partial<work.WorkRecord> = {}): work.WorkRecord => ({
  module: "material_master", record_key: key, name: null, issues: 1, severity: "critical", checks: ["MM001"], proposed: 0,
  status: "to_fix", due_at: null, assigned_to: null, assignee_email: null, top_message: "Base unit is empty", top_field: "MARA.MEINS", ...over,
});
const detail = (over: Partial<work.WorkRecordDetail> = {}): work.WorkRecordDetail => ({
  version_id: "R1", module: "material_master", record_key: "MATNR=2", name: "Nut", status: "to_fix", assigned_to: null,
  assignee_email: null, values: { "MARA.MEINS": "" }, events: [],
  can: { fix: true, sign_off: true, assign: true, comment: true },
  issues: [
    { check_id: "MM001", severity: "critical", dimension: "completeness", message: "Base unit is empty", field: "MARA.MEINS",
      current_value: "", instruction: "Set the base unit", why_it_matters: "Stock cannot be posted", sap_impact: null,
      suggestion: { value: "EA", source: "rule", confidence: "high", why: null }, status: "to_fix", issue_id: "i1",
      resolution: null, first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null },
    { check_id: "MM002", severity: "medium", dimension: "validity", message: "Material type is not allowed", field: "MARA.MTART",
      current_value: "XX", instruction: null, why_it_matters: null, sap_impact: null, suggestion: null, status: "to_fix",
      issue_id: "i2", resolution: null, first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, decision: null },
  ], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
  perms = new Set(["apply", "approve", "assign", "analyse", "export"]);
  vi.mocked(work.getWorkSummary).mockResolvedValue(summary());
  vi.mocked(work.getWorkGroups).mockResolvedValue({ version_id: "R1", built: true, total: 1, groups: [
    { check_id: "MM001", module: "material_master", severity: "critical", dimension: "completeness", message: "Base unit is empty",
      field: "MARA.MEINS", records: 2, population: 10, proposed: 1, truncated: false, statuses: { to_fix: 2 }, open: 2 },
  ] });
  vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 2, total_capped: false, next: null,
    items: [rec("MATNR=1", { name: "Bolt" }), rec("MATNR=2", { name: "Nut", issues: 2, proposed: 1 })] });
  vi.mocked(work.getWorkRecord).mockResolvedValue(detail());
  vi.mocked(work.decide).mockResolvedValue({ updated: 1, draft_batch_id: "B1" });
});

describe("FixWork", () => {
  it("names the run its counts belong to, and calls critical what it is", async () => {
    const getVersion = vi.spyOn(versions, "getVersion").mockResolvedValue({ id: "R1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T05:00:00Z", dqs_summary: null, metadata: {} });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("As of material_master_25k, 16 Oct 2026")).toBeInTheDocument();
    expect(getVersion).toHaveBeenCalledWith("R1");
    expect(screen.getByText("critical severity")).toBeInTheDocument();
    expect(screen.queryByText("block SAP processes")).toBeNull();
  });

  it("shows the totals, the issues and the records worst first, and the first record's panel", async () => {
    renderWithQuery(<FixWork />);
    expect((await screen.findAllByText("Records to fix")).length).toBeGreaterThan(0);
    expect(await screen.findAllByTestId("work-group")).toHaveLength(1);
    const rows = await screen.findAllByTestId("work-record");
    expect(rows.map((r) => within(r).getAllByText(/Bolt|Nut/)[0].textContent)).toEqual(["Bolt", "Nut"]);
    expect(rows[1]).toHaveTextContent("and 1 more issue");
    expect(await screen.findByTestId("record-panel")).toBeInTheDocument();
    expect(work.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=1", undefined);
  });

  it("filters by an issue through the URL and offers the group's mass actions", async () => {
    search = new URLSearchParams("check=MM001&run=R1");
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ check_id: "MM001", version_id: "R1", status: "open" }));
    expect(screen.getByRole("button", { name: "Accept 1 suggested" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set one value" })).toBeInTheDocument();
  });

  it("moves with j and accepts the record's suggestions with a", async () => {
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    fireEvent.keyDown(window, { key: "j" });
    expect(replace).toHaveBeenCalledWith("/fix?record=material_master%7CMATNR%3D2", { scroll: false });
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(work.decide).toHaveBeenCalledWith([{ module: "material_master", record_key: "MATNR=1", action: "accept" }], undefined));
  });

  it("opens the record from Enter on a row or the page, never from Enter on another button", async () => {
    push.mockClear();
    renderWithQuery(<FixWork />);
    const rows = await screen.findAllByTestId("work-record");
    const other = screen.getAllByRole("button").find((b) => !b.closest("[data-testid=work-record]"));
    expect(other).toBeDefined();
    expect(fireEvent.keyDown(other!, { key: "Enter" })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(within(rows[0]).getAllByRole("button")[0], { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/objects/material_master/records/MATNR%3D1");
    push.mockClear();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("says when the run's work list is not built, and lets an analyst build it", async () => {
    vi.mocked(work.getWorkSummary).mockResolvedValue(summary({ built: false }));
    vi.mocked(work.buildWorklist).mockResolvedValue({ version_id: "R1", queued: true });
    renderWithQuery(<FixWork />);
    await userEvent.click(await screen.findByRole("button", { name: "Build the work list" }));
    expect(work.buildWorklist).toHaveBeenCalled();
  });

  it("explains an empty tenant instead of an error", async () => {
    vi.mocked(work.getWorkSummary).mockRejectedValue({ response: { status: 404 } });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("No finished run yet")).toBeInTheDocument();
  });

  it("hides fixing for a viewer", async () => {
    perms = new Set(["view"]);
    vi.mocked(work.getWorkRecord).mockResolvedValue(detail({ can: { fix: false, sign_off: false, assign: false, comment: false } }));
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(screen.queryByRole("button", { name: "Import fix sheet" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(await screen.findByText(/Your role can view this record/)).toBeInTheDocument();
  });

  it("takes the drill filters from the URL: object, person and key part", async () => {
    search = new URLSearchParams("module=material_master&assignee=u-7&part=WERKS%3D1000");
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ module: "material_master", assigned: "u-7", part: "WERKS=1000" }));
    expect(screen.getByText("to one person")).toBeInTheDocument();
    expect(screen.getByText("WERKS=1000")).toBeInTheDocument();
  });

  it("takes blocking severity, every status and one source system from the URL", async () => {
    search = new URLSearchParams("sev=blocking&st=all&system=S1");
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ severity: "blocking", status: "all", system: "S1" }));
    expect(screen.getAllByText("Critical and high").length).toBeGreaterThan(0);
    expect(screen.getByText("one source system")).toBeInTheDocument();
  });

  it("says when filters match nothing and clears them", async () => {
    search = new URLSearchParams("sev=low");
    vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 0, total_capped: false, next: null, items: [] });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
  });
});

describe("RecordPanel", () => {
  it("shows each issue's value now and the suggested value, and accepts or edits it", async () => {
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R1" />);
    const issues = await screen.findAllByTestId("work-issue");
    expect(issues[0]).toHaveTextContent("Base unit is empty");
    expect(within(issues[0]).getByText("blank")).toBeInTheDocument();
    await userEvent.click(within(issues[0]).getByRole("button", { name: 'Accept "EA"' }));
    expect(work.decide).toHaveBeenCalledWith([{ module: "material_master", record_key: "MATNR=2", check_id: "MM001", action: "accept" }], "R1");

    await userEvent.click(within(issues[1]).getByRole("button", { name: "Enter value" }));
    const input = within(issues[1]).getByRole("textbox", { name: "New value for MARA.MTART" });
    await userEvent.clear(input);
    await userEvent.type(input, "FERT");
    await userEvent.click(within(issues[1]).getByRole("button", { name: "Save value" }));
    expect(work.decide).toHaveBeenLastCalledWith([{ module: "material_master", record_key: "MATNR=2", check_id: "MM002", action: "edit", value: "FERT" }], "R1");
  });

  it("needs a reason to mark an issue not an issue", async () => {
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R1" />);
    const issues = await screen.findAllByTestId("work-issue");
    await userEvent.click(within(issues[1]).getByRole("button", { name: "Not an issue" }));
    const submit = within(issues[1]).getByRole("button", { name: "Mark not an issue" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(issues[1]).getByRole("textbox", { name: "Reason" }), "Trading goods use XX");
    await userEvent.click(submit);
    expect(work.decide).toHaveBeenLastCalledWith([{ module: "material_master", record_key: "MATNR=2", check_id: "MM002", action: "not_an_issue", note: "Trading goods use XX" }], "R1");
  });

  it("warns when a value sent to SAP did not fix the record", async () => {
    const d = detail();
    d.issues[0] = { ...d.issues[0], status: "to_fix", decision: { batch_id: "B", batch_status: "exported", batch_name: "Fixes", value: "EA", source: "rule", still_failing: true, at: null } };
    vi.mocked(work.getWorkRecord).mockResolvedValue(d);
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R1" />);
    expect(await screen.findByText(/still finds the record failing/)).toBeInTheDocument();
  });
});

describe("dueLabel", () => {
  it("is overdue in the past, due today within a day, else nothing", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(dueLabel("2026-10-25T11:00:00Z", now)?.label).toBe("Overdue");
    expect(dueLabel("2026-10-26T06:00:00Z", now)?.label).toBe("Due today");
    expect(dueLabel("2026-10-30T06:00:00Z", now)).toBeNull();
    expect(dueLabel(null, now)).toBeNull();
  });
});
