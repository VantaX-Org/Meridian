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
import * as connectivity from "@/lib/api/connectivity";
import * as configLoad from "@/lib/api/config-load";

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
  objects: [{ module: "material_master", version_id: "R1", records: 2, open: 2, issues: 3, critical: 2, proposed: 1, overdue: 1, statuses: { to_fix: 2 } }],
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
  it("counts the tiles for the active filters: Mine shows my records, not everyone's", async () => {
    search = new URLSearchParams("mine=1&sev=critical");
    vi.mocked(work.getWorkSummary).mockImplementation(async (_run, filter) =>
      filter ? summary({ totals: { records: 1, open: 1, issues: 1, critical: 1, proposed: 0, overdue: 0 } })
        : summary({ totals: { records: 24712, open: 24712, issues: 30000, critical: 900, proposed: 50, overdue: 7 } }));
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkSummary).toHaveBeenCalledWith(undefined, expect.objectContaining({ assigned: "me", severity: "critical", status: "open" }));
    await waitFor(() => expect(screen.getByText(/these filters/)).toBeInTheDocument());
    expect(screen.queryByText("24,712")).toBeNull();
  });

  it.each([
    ["mine=1", { assigned: "me" }],
    ["sev=critical&st=all", { severity: "critical", status: "all" }],
    ["check=MM001&sugg=1", { check_id: "MM001", proposed: true }],
    ["object=material_master&mine=1&due=overdue&q=bolt", { module: "material_master", assigned: "me", due: "overdue", q: "bolt" }],
    ["run=R1&assignee=u-7&part=WERKS%3D1000", { assigned: "u-7", part: "WERKS=1000" }],
  ])("asks /work/summary with exactly the list's filters (%s)", async (qs, expected) => {
    search = new URLSearchParams(qs);
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    await waitFor(() => expect(vi.mocked(work.getWorkSummary).mock.calls.some(([, f]) => f !== undefined)).toBe(true));
    const [run, tileFilter] = vi.mocked(work.getWorkSummary).mock.calls.find(([, f]) => f !== undefined)!;
    const { version_id, ...rest } = vi.mocked(work.getWorkRecords).mock.calls.at(-1)![0];
    // The page's own keys (sort, cursor, size) are not filters.
    const listFilter = Object.fromEntries(Object.entries(rest).filter(([k]) => !["sort", "after", "limit"].includes(k)));
    // The same run and the same filters, key for key: the tiles can only count the rows the list shows.
    expect(run).toBe(version_id);
    const defined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    expect(defined(tileFilter ?? {})).toEqual(defined(listFilter));
    expect(defined(listFilter)).toEqual(expect.objectContaining(expected));
  });

  it("asks for no filtered summary without a filter: the plain totals are the list's", async () => {
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkSummary).toHaveBeenCalledTimes(1);
    expect(work.getWorkSummary).toHaveBeenCalledWith(undefined);
  });

  it("offers a visible Load more while pages remain, and loads the next page from it", async () => {
    vi.mocked(work.getWorkRecords).mockImplementation(async (f) => f.after
      ? { version_id: "R1", total: 3, total_capped: false, next: null, items: [rec("MATNR=3", { name: "Washer" })] }
      : { version_id: "R1", total: 3, total_capped: false, next: "c1", items: [rec("MATNR=1", { name: "Bolt" }), rec("MATNR=2", { name: "Nut" })] });
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    await userEvent.click(await screen.findByRole("button", { name: "Load more records (2 of 3 loaded)" }));
    await waitFor(() => expect(screen.getAllByTestId("work-record")).toHaveLength(3));
    expect(work.getWorkRecords).toHaveBeenLastCalledWith(expect.objectContaining({ after: "c1" }));
    expect(screen.queryByRole("button", { name: /^Load more records/ })).toBeNull();
  });

  it("names the run its counts belong to when ?run= pins one, and calls critical what it is", async () => {
    search = new URLSearchParams("run=R1");
    const getVersion = vi.spyOn(versions, "getVersion").mockResolvedValue({ id: "R1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T05:00:00Z", dqs_summary: null, metadata: {} });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("As of Material master, 16 Oct, 05:00")).toBeInTheDocument();
    expect(getVersion).toHaveBeenCalledWith("R1");
    expect(screen.getByText("records with a critical rule failure")).toBeInTheDocument();
    expect(screen.queryByText("block SAP processes")).toBeNull();
  });

  it("shows the totals, the issues and the records worst first, and the first record's panel", async () => {
    renderWithQuery(<FixWork />);
    expect((await screen.findAllByText("Records to fix")).length).toBeGreaterThan(0);
    expect(await screen.findAllByTestId("work-group")).toHaveLength(1);
    // An issue's name wraps to two lines in the pane rather than cutting at one, whole in its title.
    const groupName = screen.getByTestId("work-group-name");
    expect(groupName).toHaveClass("line-clamp-2");
    expect(groupName).not.toHaveClass("truncate");
    expect(groupName).toHaveAttribute("title", groupName.textContent);
    const rows = await screen.findAllByTestId("work-record");
    expect(rows.map((r) => within(r).getAllByText(/Bolt|Nut/)[0].textContent)).toEqual(["Bolt", "Nut"]);
    expect(rows[1]).toHaveTextContent("MM001 and 1 more");
    expect(await screen.findByTestId("record-panel")).toBeInTheDocument();
    // The record opens in the run it was found in (the current state names each object's run).
    expect(work.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=1", "R1");
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
    await waitFor(() => expect(work.decide).toHaveBeenCalledWith([{ module: "material_master", record_key: "MATNR=1", action: "accept" }], "R1"));
  });

  it("opens the record from Enter on a row or the page, never from Enter on another button", async () => {
    push.mockClear();
    renderWithQuery(<FixWork />);
    const rows = await screen.findAllByTestId("work-record");
    const other = screen.getAllByRole("button").find((b) => !b.closest("[data-testid=work-record]"));
    expect(other).toBeDefined();
    expect(fireEvent.keyDown(other!, { key: "Enter" })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/objects/material_master/records/MATNR%3D1?run=R1");
    push.mockClear();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("says when the run's work list is not built, and lets an analyst build it", async () => {
    search = new URLSearchParams("run=R1");
    vi.mocked(work.getWorkSummary).mockResolvedValue(summary({ built: false, unbuilt: ["R1"] }));
    vi.mocked(work.buildWorklist).mockResolvedValue({ version_id: "R1", queued: true });
    renderWithQuery(<FixWork />);
    await userEvent.click(await screen.findByRole("button", { name: "Build the work list" }));
    expect(work.buildWorklist).toHaveBeenCalledWith("R1");
  });

  describe("without ?run=: the current state, every object at its own latest run", () => {
    const current = () => summary({
      version_id: null, scope: null, mode: "current", version_ids: ["RM", "RA"], unbuilt: [],
      objects: [
        { module: "material_master", version_id: "RM", records: 1, open: 1, issues: 1, critical: 1, proposed: 0, overdue: 0, statuses: { to_fix: 1 } },
        { module: "accounts_payable", version_id: "RA", records: 1, open: 1, issues: 1, critical: 1, proposed: 0, overdue: 0, statuses: { to_fix: 1 } },
      ],
      totals: { records: 2, open: 2, issues: 2, critical: 2, proposed: 0, overdue: 0 },
    });
    beforeEach(() => {
      vi.mocked(work.getWorkSummary).mockResolvedValue(current());
      vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: null, total: 2, total_capped: false, next: null, items: [
        rec("MATNR=1", { name: "Bolt", version_id: "RM" }),
        rec("LIFNR=7", { module: "accounts_payable", name: "Acme", version_id: "RA", checks: ["AP001"] }),
      ] });
    });

    it("counts every object, says so, and reads no run", async () => {
      renderWithQuery(<FixWork />);
      expect(await screen.findByTestId("fix-scope")).toHaveTextContent("each object at its own latest run");
      expect(screen.getByText("2 rule failures on them, across 2 objects")).toBeInTheDocument();
      expect(work.getWorkSummary).toHaveBeenCalledWith(undefined);
      expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ version_id: undefined }));
    });

    it("opens a record in the run it was found in, and decides each record in its own run", async () => {
      renderWithQuery(<FixWork />);
      const rows = await screen.findAllByTestId("work-record");
      await waitFor(() => expect(work.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=1", "RM"));
      for (const r of rows) await userEvent.click(within(r).getByRole("checkbox"));
      await userEvent.click(screen.getByRole("button", { name: "Accept suggestions" }));
      await waitFor(() => expect(work.decide).toHaveBeenCalledTimes(2));
      expect(work.decide).toHaveBeenCalledWith([{ module: "material_master", record_key: "MATNR=1", action: "accept" }], "RM");
      expect(work.decide).toHaveBeenCalledWith([{ module: "accounts_payable", record_key: "LIFNR=7", action: "accept" }], "RA");
    });

    it("lists what it can and offers to build the runs that have no work list", async () => {
      vi.mocked(work.getWorkSummary).mockResolvedValue({ ...current(), unbuilt: ["RX"] });
      vi.mocked(work.buildWorklist).mockResolvedValue({ version_id: "RX", queued: true });
      renderWithQuery(<FixWork />);
      expect(await screen.findAllByTestId("work-record")).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "Build the work list" }));
      await waitFor(() => expect(work.buildWorklist).toHaveBeenCalledWith("RX"));
    });
  });

  it("explains an empty tenant instead of an error", async () => {
    vi.mocked(work.getWorkSummary).mockRejectedValue({ response: { status: 404 } });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("No finished run yet")).toBeInTheDocument();
  });

  it("offers a steward with no system the day-one step they can take themselves: import a file", async () => {
    perms = new Set(["apply", "approve", "upload"]);
    vi.mocked(work.getWorkSummary).mockRejectedValue({ response: { status: 404 } });
    vi.spyOn(connectivity, "getSystems").mockResolvedValue([]);
    vi.spyOn(configLoad, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 0 });
    vi.spyOn(versions, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<FixWork />);
    expect(await screen.findByRole("link", { name: "Import a file" })).toHaveAttribute("href", "/import");
    expect(screen.getByText(/Connecting a live system needs an administrator/)).toBeInTheDocument();
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

  describe("the dense queue", () => {
    const day = 86_400_000;
    const ago = (d: number) => new Date(Date.now() - d * day - 3_600_000).toISOString();
    beforeEach(() => {
      vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 3, total_capped: false, next: null, items: [
        rec("MATNR=1", { name: "Bolt", first_seen_at: ago(3), due_at: ago(1), assignee_email: "ann@example.com" }),
        rec("MATNR=2", { name: "Nut", first_seen_at: ago(40), proposed: 1, suggested_value: "EA" }),
        rec("MATNR=3", { name: "Washer", severity: "high", first_seen_at: ago(90), status: "proposed" }),
      ] });
    });

    it("shows Record, Rule, Severity, Age, Due, Assignee and Suggested value, asking the server for severity, then the oldest", async () => {
      // Every width query matches except the phone one, which would turn the queue into cards (this test reads the table).
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q !== "(max-width: 639px)", media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
      renderWithQuery(<FixWork />);
      const rows = await screen.findAllByTestId("work-record");
      const headers = within(screen.getByRole("grid", { name: "Records to fix" })).getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["", "Record", "Rule", "Severity", "Age", "Due", "Assignee", "Suggested value"]);
      // The sort is the server's (global over every page), and the table keeps its order: no re-sort of loaded rows.
      expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ sort: "severity,-age" }));
      expect(rows.map((r) => within(r).getByText(/Bolt|Nut|Washer/).textContent)).toEqual(["Bolt", "Nut", "Washer"]);
      expect(rows[1]).toHaveTextContent("40 d");
      expect(within(rows[1]).getByText("EA")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Overdue")).toBeInTheDocument();
      expect(rows[0]).toHaveTextContent("ann@example.com");
      expect(within(rows[2]).getByText("Fix proposed")).toBeInTheDocument();
      // j walks the table's order.
      fireEvent.keyDown(window, { key: "j" });
      expect(replace).toHaveBeenLastCalledWith("/fix?record=material_master%7CMATNR%3D2", { scroll: false });
      vi.unstubAllGlobals();
    });

    it("sends the URL's sort to the server and sorts only the columns the server pages by", async () => {
      search = new URLSearchParams("sort=-age");
      renderWithQuery(<FixWork />);
      const rows = await screen.findAllByTestId("work-record");
      expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ sort: "-age" }));
      expect(rows.map((r) => within(r).getByText(/Bolt|Nut|Washer/).textContent)).toEqual(["Bolt", "Nut", "Washer"]);
      // Record, Rule, Due, Assignee and Suggested value are not sortable: a sort of the loaded page would lie.
      expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Severity" }));
      expect(replace).toHaveBeenLastCalledWith(expect.stringMatching(/^\/fix\?sort=.*severity/), { scroll: false });
    });

    it("asks for the default sort when the URL names a column the server does not sort", async () => {
      search = new URLSearchParams("sort=record");
      renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ sort: "severity,-age" }));
    });

    it("shows a record's key on its own line in Mono, cut with an ellipsis (never mid-key) and whole in the title", async () => {
      vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 1, total_capped: false, next: null,
        items: [rec("MATNR=MAT000012345678|WERKS=1000", { name: "Bolt" })] });
      renderWithQuery(<FixWork />);
      const key = (await screen.findAllByTestId("work-record-key"))[0];
      expect(key).toHaveTextContent("MATNR=MAT000012345678|WERKS=1000");
      expect(key).toHaveClass("truncate", "whitespace-nowrap", "block");
      expect(key).not.toHaveClass("break-all");
      expect(key.style.fontFamily).toBe("var(--m-font-mono)");
      expect(key.parentElement).toHaveAttribute("title", "Bolt, MATNR=MAT000012345678|WERKS=1000");
    });

    it("keeps Suggested value off the queue below 1600px, where the panes leave no room for it", async () => {
      const wide = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q === "(min-width: 1600px)", media: q,
        addEventListener: () => undefined, removeEventListener: () => undefined }));
      wide(true);
      const { unmount } = renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      expect(within(screen.getByRole("grid", { name: "Records to fix" })).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Suggested value");
      unmount();
      wide(false);
      renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      expect(within(screen.getByRole("grid", { name: "Records to fix" })).getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Suggested value");
      vi.unstubAllGlobals();
    });

    it("gives the rule its own two-line cell below 1600px: the whole name, its check id under it, no Assignee column", async () => {
      vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 1, total_capped: false, next: null,
        items: [rec("MATNR=1", { name: "Bolt", issues: 3, top_message: "Cost centre validity start date is mandatory", checks: ["CO003"] })] });
      renderWithQuery(<FixWork />);
      const [row] = await screen.findAllByTestId("work-record");
      const headers = within(screen.getByRole("grid", { name: "Records to fix" })).getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["", "Record", "Rule", "Severity", "Age", "Due"]);
      const name = within(row).getByTestId("work-rule-name");
      expect(name).toHaveTextContent(/^Cost centre validity start date is mandatory$/);
      // The name is alone on its line (the id is on the next), in a cell up to 300px wide: no "Cost centre …" at 1440px.
      expect(name.parentElement).toHaveClass("flex-col", "max-w-[300px]");
      expect(name.parentElement).not.toHaveClass("w-[160px]");
      expect(name.nextElementSibling).toHaveTextContent("CO003 and 2 more");
    });

    it("names each record's assignee below 1600px as an initials chip in the Record cell, without narrowing the rule", async () => {
      vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 3, total_capped: false, next: null, items: [
        rec("MATNR=1", { name: "Bolt", assignee_email: "ann.lee@example.com", top_message: "Cost centre validity start date is mandatory" }),
        rec("MATNR=2", { assignee_email: "bob@example.com" }),
        rec("MATNR=3", { name: "Washer" }),
      ] });
      renderWithQuery(<FixWork />);
      const rows = await screen.findAllByTestId("work-record");
      const chip = within(rows[0]).getByRole("img", { name: "Assigned to ann.lee@example.com" });
      expect(chip).toHaveTextContent(/^AL$/);
      expect(chip).toHaveAttribute("title", "Assigned to ann.lee@example.com");
      // A record without a name carries the chip on its key line; an unassigned record has none.
      expect(within(rows[1]).getByRole("img", { name: "Assigned to bob@example.com" })).toHaveTextContent(/^BO$/);
      expect(within(rows[2]).queryByTestId("work-assignee-chip")).toBeNull();
      // The rule keeps its own cell, up to 300px, whole name.
      expect(within(rows[0]).getByTestId("work-rule-name").parentElement).toHaveClass("max-w-[300px]");
    });

    it("leaves the chip to the Assignee column from 1600px", async () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(min-width: 1600px)", media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
      renderWithQuery(<FixWork />);
      const rows = await screen.findAllByTestId("work-record");
      expect(rows[0]).toHaveTextContent("ann@example.com");
      expect(screen.queryByTestId("work-assignee-chip")).toBeNull();
      vi.unstubAllGlobals();
    });

    it("marks only the primary sort column: Severity shows its arrow, the age tie-break none", async () => {
      renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      const grid = screen.getByRole("grid", { name: "Records to fix" });
      const header = (n: string) => within(grid).getAllByRole("columnheader").find((h) => h.textContent === n)!;
      expect(header("Severity")).toHaveAttribute("aria-sort", "ascending");
      expect(header("Severity").querySelector("svg")).not.toBeNull();
      expect(header("Age")).toHaveAttribute("aria-sort", "none");
      expect(header("Age").querySelector("svg")).toBeNull();
      expect(within(header("Severity")).getByRole("button")).toHaveAttribute("title", "Sorted by this column, then age");
    });

    it("ships saved views that set the queue's filters in the URL", async () => {
      search = new URLSearchParams("run=R1&sev=low");
      renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      await userEvent.click(screen.getByRole("button", { name: /^Views/ }));
      await userEvent.click(await screen.findByRole("button", { name: "Mine, open, oldest first" }));
      expect(replace).toHaveBeenLastCalledWith("/fix?run=R1&mine=1&sort=-age", { scroll: false });
      await userEvent.click(screen.getByRole("button", { name: "Has a suggestion" }));
      expect(replace).toHaveBeenLastCalledWith("/fix?run=R1&sugg=1", { scroll: false });
    });

    it("leaves the record search and the object to the scope bar, and puts the downloads in one export menu", async () => {
      renderWithQuery(<FixWork />);
      await screen.findAllByTestId("work-record");
      expect(screen.queryByRole("textbox", { name: "Find a record" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Object" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Download fix sheet" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /^Export/ }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Fix sheet, one sheet per object (.xlsx)" }));
      await waitFor(() => expect(work.downloadFixSheetByObject).toHaveBeenCalledWith(expect.objectContaining({ status: "open" })));
      expect(screen.getByRole("button", { name: "Import fix sheet" })).toBeInTheDocument();
    });
  });
});

describe("FixWork Issues pane under the list's filters", () => {
  const group = (check_id: string, open: number, severity: work.WorkSeverity = "critical"): work.WorkGroup => ({
    check_id, module: "material_master", severity, dimension: "completeness", message: `Rule ${check_id}`, field: null,
    records: open, population: 100, proposed: 0, truncated: false, statuses: { to_fix: open }, open,
  });
  beforeEach(() => {
    vi.mocked(work.getWorkGroups).mockResolvedValue({ version_id: "R1", built: true, total: 3,
      groups: [group("MM001", 50), group("MM002", 40), group("MM003", 30, "high")] });
  });

  it("with Mine and none of my records, lists no issues instead of every rule's count", async () => {
    search = new URLSearchParams("mine=1");
    vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 0, total_capped: false, next: null, items: [] });
    renderWithQuery(<FixWork />);
    expect(await screen.findByText("No issues on the records these filters show.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("work-group")).toHaveLength(0);
    expect(screen.getByText("0 failing rules on these records")).toBeInTheDocument();
  });

  it("with Mine and the whole list loaded, counts each issue on my records only", async () => {
    search = new URLSearchParams("mine=1");
    vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 2, total_capped: false, next: null, items: [
      rec("MATNR=1", { checks: ["MM003"], severity: "high" }), rec("MATNR=2", { checks: ["MM003", "MM002"] }),
    ] });
    renderWithQuery(<FixWork />);
    await waitFor(() => expect(screen.getAllByTestId("work-group")).toHaveLength(2));
    const groups = screen.getAllByTestId("work-group").map((g) => g.textContent);
    // Worst first: the critical MM002 (1 of my records), then the high MM003 (2); MM001 is on none of mine.
    expect(groups[0]).toMatch(/Rule MM002.*1/);
    expect(groups[1]).toMatch(/Rule MM003.*2/);
    expect(screen.getByText("2 failing rules on these records")).toBeInTheDocument();
  });

  it("says it lists every open issue when the filtered list is longer than what is loaded", async () => {
    search = new URLSearchParams("st=all");
    vi.mocked(work.getWorkRecords).mockResolvedValue({ version_id: "R1", total: 900, total_capped: false, next: "c1", items: [rec("MATNR=1")] });
    renderWithQuery(<FixWork />);
    expect(await screen.findByTestId("work-issues-scope")).toHaveTextContent("Every open issue: these counts do not follow the status.");
    expect(await screen.findAllByTestId("work-group")).toHaveLength(3);
  });

  it("asks the groups for Has a suggestion, which they filter themselves", async () => {
    search = new URLSearchParams("sugg=1");
    renderWithQuery(<FixWork />);
    await screen.findAllByTestId("work-record");
    expect(work.getWorkGroups).toHaveBeenCalledWith(expect.objectContaining({ proposed: true }));
    expect(screen.queryByTestId("work-issues-scope")).toBeNull();
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

describe("FixWork new since baseline", () => {
  it("asks the API for exactly the records new since the baseline run and names it in a chip", async () => {
    search = new URLSearchParams("run=R2&module=material_master&since=R1");
    vi.spyOn(versions, "getVersion").mockResolvedValue({ id: "R1", label: "Oct 12", status: "complete", run_at: "2026-10-12T05:00:00Z", dqs_summary: null, metadata: {} });
    renderWithQuery(<FixWork />);
    await screen.findByTestId("fix-work");
    await waitFor(() => expect(work.getWorkRecords).toHaveBeenCalledWith(expect.objectContaining({ version_id: "R2", since: "R1", module: "material_master" })));
    expect(work.getWorkSummary).toHaveBeenCalledWith("R2", expect.objectContaining({ since: "R1" }));
    const chip = await screen.findByText("New since");
    expect(chip.parentElement).toHaveTextContent("New since12 Oct 2026");
  });

  it("removes the baseline with its chip, and Clear filters resets it", async () => {
    search = new URLSearchParams("run=R2&module=material_master&since=R1&sev=critical");
    vi.spyOn(versions, "getVersion").mockResolvedValue({ id: "R1", label: "Oct 12", status: "complete", run_at: "2026-10-12T05:00:00Z", dqs_summary: null, metadata: {} });
    renderWithQuery(<FixWork />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove filter New since" }));
    expect(replace).toHaveBeenLastCalledWith("/fix?run=R2&module=material_master&sev=critical", { scroll: false });
    replace.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const next = new URLSearchParams(String(replace.mock.calls[0][0]).split("?")[1] ?? "");
    expect(next.has("since")).toBe(false);
  });

  it("ignores a baseline without a run: the current state is not one run to compare", async () => {
    search = new URLSearchParams("since=R1");
    renderWithQuery(<FixWork />);
    await screen.findByTestId("fix-work");
    await waitFor(() => expect(work.getWorkRecords).toHaveBeenCalled());
    expect(work.getWorkRecords).toHaveBeenCalledWith(expect.not.objectContaining({ since: "R1" }));
    expect(screen.queryByText("New since")).toBeNull();
  });
});
