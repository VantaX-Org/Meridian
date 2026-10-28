// Comments on a record's issues, in a drawer opened from the Fix record sheet.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../../__tests__/render";
import { IssueComments, commentsOf } from "../issue-comments";
import * as work from "@/lib/api/work";
import * as issues from "@/lib/api/issues";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const issue = (check: string, id: string | null, message: string): work.WorkIssue => ({
  check_id: check, severity: "critical", dimension: "completeness", message, field: "MARA.MEINS", current_value: "", instruction: null,
  why_it_matters: null, sap_impact: null, suggestion: null, status: "to_fix", issue_id: id, resolution: null, first_seen_at: null,
  reopened_count: 0, due_at: null, sla_state: null, decision: null,
});
const record = (over: Partial<work.WorkRecordDetail> = {}): work.WorkRecordDetail => ({
  version_id: "R1", module: "material_master", record_key: "MATNR=2", name: "Nut", status: "to_fix", assigned_to: null, assignee_email: null,
  values: {}, events: [], issues: [issue("MM001", "i1", "Base unit is empty")], can: { fix: true, sign_off: true, assign: true, comment: true }, ...over,
});
const event = (action: issues.IssueEvent["action"], note: string | null, who = "ana"): issues.IssueEvent => ({
  action, from_value: null, to_value: null, note, user_label: who, version_id: null, created_at: "2026-10-20T08:30:00Z",
});
const thread = (events: issues.IssueEvent[]) => ({ issue: {} as issues.RecordIssue, events, runs: [] });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(work, "getWorkRecord").mockResolvedValue(record());
  vi.spyOn(issues, "getIssue").mockResolvedValue(thread([event("status", null), event("comment", "Asked finance, base unit is EA")]));
});

const open = async () => {
  renderWithQuery(<IssueComments module="material_master" recordKey="MATNR=2" run="R1" />);
  await userEvent.click(screen.getByRole("button", { name: "Comments on this record" }));
};

describe("IssueComments", () => {
  it("reads the comments of the record's issue, leaving other events out", async () => {
    await open();
    const list = await screen.findByRole("list", { name: "Comments" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent("Asked finance, base unit is EA");
    expect(issues.getIssue).toHaveBeenCalledWith("i1");
    expect(work.getWorkRecord).toHaveBeenCalledWith("material_master", "MATNR=2", "R1");
  });

  it("posts a comment on the issue and reloads the thread", async () => {
    const post = vi.spyOn(issues, "commentIssue").mockResolvedValue();
    await open();
    await userEvent.type(await screen.findByRole("textbox", { name: "Add a comment" }), "Fixed in the source");
    await userEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("i1", "Fixed in the source"));
    await waitFor(() => expect(vi.mocked(issues.getIssue).mock.calls.length).toBeGreaterThan(1));
  });

  it("reads only when the viewer may not comment", async () => {
    vi.spyOn(work, "getWorkRecord").mockResolvedValue(record({ can: { fix: false, sign_off: false, assign: false, comment: false } }));
    await open();
    await screen.findByRole("list", { name: "Comments" });
    expect(screen.queryByRole("textbox", { name: "Add a comment" })).toBeNull();
  });

  it("picks which issue to read when the record has several, keyed by the issue id", async () => {
    vi.spyOn(work, "getWorkRecord").mockResolvedValue(record({ issues: [issue("MM001", "i1", "Base unit is empty"), issue("MM002", "i2", "Material type is not allowed"), issue("MM003", null, "Not yet a tracked issue")] }));
    await open();
    await screen.findByRole("list", { name: "Comments" });
    await userEvent.click(screen.getByRole("combobox", { name: /Issue, 2 issues/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Material type is not allowed" }));
    await waitFor(() => expect(issues.getIssue).toHaveBeenCalledWith("i2"));
  });

  it("says plainly when there are no comments yet or no issue to comment on", async () => {
    vi.spyOn(issues, "getIssue").mockResolvedValue(thread([]));
    await open();
    expect(await screen.findByText("No comments yet")).toBeInTheDocument();
  });

  it("has no issue to comment on when none carries an id", async () => {
    vi.spyOn(work, "getWorkRecord").mockResolvedValue(record({ issues: [issue("MM001", null, "Base unit is empty")] }));
    await open();
    expect(await screen.findByText("No issue to comment on")).toBeInTheDocument();
    expect(issues.getIssue).not.toHaveBeenCalled();
  });
});

describe("commentsOf", () => {
  it("keeps the comments with text, in order", () => {
    expect(commentsOf([event("assign", "x"), event("comment", null), event("comment", "a"), event("comment", "b")]).map((e) => e.note)).toEqual(["a", "b"]);
  });
});
