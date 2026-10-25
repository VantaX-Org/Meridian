// The record panel's detail: the rule, how many records share the issue, its history and SLA, the values the rule
// accepts (one click fills the edit box), and the record beyond this run (last run, golden record, duplicates).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../__tests__/render";
import { RecordPanel, historyLine, issueAnchor, lastRunLine, populationLine, ruleHref, sameIssueHref } from "../record-panel";
import * as work from "@/lib/api/work";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/api/work", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/work")>("@/lib/api/work");
  return { ...actual, getWorkRecord: vi.fn(), decide: vi.fn() };
});

const issue = (over: Partial<work.WorkIssue> = {}): work.WorkIssue => ({
  check_id: "MM002", severity: "medium", dimension: "validity", message: "Material type is not allowed", field: "MARA.MTART",
  current_value: "XX", instruction: null, why_it_matters: null, sap_impact: null, suggestion: null, status: "to_fix",
  issue_id: "i2", resolution: null, first_seen_at: "2026-10-12T08:00:00+00:00", reopened_count: 2,
  due_at: "2026-11-01T00:00:00+00:00", sla_state: "on_track", decision: null,
  rule: { id: "7d0c", name: "Material type must be a configured type", dimension: "validity", authority: null,
    cost_at_risk: 120000, cost_per_record: 99.67 },
  failing: 1204, others_failing: 1203, population: 25000, pass_rate: 95.2,
  allowed_values: [{ value: "FERT", label: "Finished product" }, { value: "ROH", label: null }],
  ...over,
});

const detail = (over: Partial<work.WorkRecordDetail> = {}): work.WorkRecordDetail => ({
  version_id: "R2", module: "material_master", record_key: "MATNR=2", name: "Nut", status: "to_fix", assigned_to: null,
  assignee_email: null, values: { "MARA.MTART": "XX" }, events: [], can: { fix: true, sign_off: true, assign: true, comment: true },
  issues: [issue(), issue({ check_id: "MM001", severity: "critical", message: "Base unit is empty", field: "MARA.MEINS", current_value: "",
    first_seen_at: null, reopened_count: 0, due_at: null, sla_state: null, allowed_values: null, others_failing: 0, failing: 1,
    population: null, pass_rate: null, rule: { id: null, name: null, dimension: "completeness", authority: null, cost_at_risk: null, cost_per_record: null } })],
  other_runs: { version_id: "R1", run_at: "2026-10-20T08:00:00+00:00", on_list: true, issues: 3, status: "to_fix",
    checks: ["MM001", "MM003", "MM004"], fixed_since: ["MM003", "MM004"], new_since: ["MM002"] },
  golden_record: { id: "g1", status: "golden", key: "2", href: "/mdm/golden/g1" },
  duplicates: { open: 2, href: "/fix?tab=dedup" },
  currency: "ZAR",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(work.getWorkRecord).mockResolvedValue(detail());
});

describe("record panel detail", () => {
  it("writes the population, history and last-run sentences", () => {
    expect(populationLine(issue())).toBe("Fails in 1,204 of 25,000 records (95.2% pass)");
    expect(populationLine(issue({ population: null, failing: 1 }))).toBe("Fails in 1 record");
    expect(populationLine(issue({ failing: undefined }))).toBeNull();
    expect(historyLine(issue())).toBe("First seen 12 Oct 2026, reopened twice. Due 1 Nov 2026, on track");
    expect(historyLine(issue({ first_seen_at: null, reopened_count: 1, due_at: null }))).toBe("Reopened once");
    expect(historyLine(issue({ first_seen_at: null, reopened_count: 0, due_at: null }))).toBeNull();
    expect(lastRunLine(detail())).toBe("Last run: 3 issues, now 2 (2 fixed since, 1 new)");
    expect(lastRunLine(detail({ other_runs: { ...detail().other_runs!, on_list: false, issues: 0 } }))).toBe("Last run: passing, now 2 issues");
    expect(lastRunLine(detail({ other_runs: null }))).toBeNull();
    expect(ruleHref(issue(), "material_master", "R2")).toBe("/rules/7d0c");
    expect(ruleHref(issue({ rule: undefined }), "material_master", "R2")).toBe("/objects/material_master/rules/MM002?run=R2");
    expect(sameIssueHref("MM002", "material_master", "R2")).toBe("/fix?check=MM002&module=material_master&run=R2");
    expect(issueAnchor("FI.GL/01")).toBe("issue-FI_GL_01");
  });

  it("shows each issue's rule, reach, history, cost and links", async () => {
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R2" />);
    const [mm002, mm001] = await screen.findAllByTestId("work-issue");
    expect(mm002).toHaveAttribute("id", "issue-MM002");
    const facts = within(mm002).getByTestId("issue-facts");
    expect(within(facts).getByRole("link", { name: "Material type must be a configured type" })).toHaveAttribute("href", "/rules/7d0c");
    expect(facts).toHaveTextContent("Fails in 1,204 of 25,000 records (95.2% pass).");
    expect(within(facts).getByRole("link", { name: "Every record with this issue" }))
      .toHaveAttribute("href", "/fix?check=MM002&module=material_master&run=R2");
    expect(facts).toHaveTextContent("First seen 12 Oct 2026, reopened twice. Due 1 Nov 2026, on track");
    expect(facts).toHaveTextContent(/ZAR\s100 at risk on this record, ZAR\s120,000 across the rule/);

    // No library row: the rule on the object for the run, by check id; nobody else fails it.
    const f1 = within(mm001).getByTestId("issue-facts");
    expect(within(f1).getByRole("link", { name: "MM001" })).toHaveAttribute("href", "/objects/material_master/rules/MM001?run=R2");
    expect(f1).toHaveTextContent("Fails in 1 record. No other record fails it");
    expect(within(f1).queryByText(/at risk/)).toBeNull();
    expect(within(mm001).queryByText("Allowed values")).toBeNull();
  });

  it("lists the allowed values as chips, and Use fills the edit box", async () => {
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R2" />);
    const [mm002] = await screen.findAllByTestId("work-issue");
    const chips = within(mm002).getByRole("list", { name: "Allowed values for MARA.MTART" });
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["FERTFinished productUse", "ROHUse"]);
    await userEvent.click(within(chips).getByRole("button", { name: "Use ROH" }));
    expect(within(mm002).getByRole("textbox", { name: "New value for MARA.MTART" })).toHaveValue("ROH");
    await userEvent.click(within(chips).getByRole("button", { name: "Use FERT" }));
    expect(within(mm002).getByRole("textbox", { name: "New value for MARA.MTART" })).toHaveValue("FERT");
  });

  it("folds a long list of allowed values, and offers no Use without the apply permission", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `V${i}`, label: null }));
    vi.mocked(work.getWorkRecord).mockResolvedValue(detail({
      can: { fix: false, sign_off: false, assign: false, comment: false },
      issues: [issue({ allowed_values: many })],
    }));
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R2" />);
    const summary = await screen.findByText("Allowed values (12)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("puts the record in context: the last run, its golden record and its open duplicates", async () => {
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R2" />);
    const ctx = await screen.findByTestId("record-context");
    expect(ctx).toHaveTextContent("Last run: 3 issues, now 2 (2 fixed since, 1 new), run of 20 Oct 2026");
    expect(within(ctx).getByRole("link", { name: "Golden record" })).toHaveAttribute("href", "/mdm/golden/g1");
    expect(within(ctx).getByRole("link", { name: "2 open duplicate candidates" })).toHaveAttribute("href", "/fix?tab=dedup");
  });

  it("leaves the context out when the server sends none of it", async () => {
    vi.mocked(work.getWorkRecord).mockResolvedValue(detail({ other_runs: undefined, golden_record: undefined, duplicates: { open: 0, href: "/fix?tab=dedup" } }));
    renderWithQuery(<RecordPanel module="material_master" recordKey="MATNR=2" run="R2" />);
    await screen.findAllByTestId("work-issue");
    expect(screen.queryByTestId("record-context")).toBeNull();
  });
});
