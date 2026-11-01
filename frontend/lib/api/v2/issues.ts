/**
 * Record issues client: one row per record and rule that failed, carried from run to run with its status, owner and
 * history (api/routes/record_issues.py).
 *
 *   GET  /issues?status=&severity=&assigned_to=&search=&limit=&offset=   (counts per status ignore the status filter)
 *   GET  /issues/{id}                                                    (the issue, its events and its last 20 runs)
 *   POST /issues/bulk                                                    (status, resolution, assignee or a note)
 *   POST /issues/{id}/comments
 *   GET  /issues/export?format=xlsx                                      (same filters, needs export)
 *
 * Accepting needs approve, other status changes and assignment need assign, a bare note needs analyse.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

export const ISSUE_STATUSES = ["open", "in_progress", "waiting_sap", "waiting_requester", "accepted", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssueResolution = "accepted_risk" | "false_positive" | "fixed_in_source";

/** The resolutions each closing status takes, as the route checks them. */
export const RESOLUTIONS: Partial<Record<IssueStatus, IssueResolution[]>> = {
  accepted: ["accepted_risk", "false_positive"],
  resolved: ["fixed_in_source"],
};

export interface Issue {
  id: string;
  scope: string | null;
  module: string;
  check_id: string;
  record_key: string;
  severity: string;
  status: IssueStatus;
  resolution: IssueResolution | null;
  assigned_to: string | null;
  assignee_email: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  resolved_at: string | null;
  reopened_count: number;
  due_at: string | null;
  sla_state: string | null;
  message: string | null;
  field: string | null;
}

export interface IssueEvent {
  action: "status" | "assign" | "comment";
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  user_label: string | null;
  created_at: string;
}

export interface IssueRun {
  version_id: string;
  run_at: string | null;
  failing: boolean;
}

export interface IssueQuery {
  status?: string;
  severity?: string;
  assigned_to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const ISSUE_PAGE = 100;

const params = (q: IssueQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ""));

export const getIssues = (q: IssueQuery) =>
  v2Get<{ total: number; counts: Partial<Record<IssueStatus, number>>; items: Issue[] }>("/issues", params(q));

export const getIssue = (id: string) =>
  v2Get<{ issue: Issue; events: IssueEvent[]; runs: IssueRun[] }>(`/issues/${encodeURIComponent(id)}`);

export const bulkIssues = (body: { ids: string[]; status?: IssueStatus; resolution?: IssueResolution; assigned_to?: string; note?: string }) =>
  v2Send<{ updated: number }>("POST", "/issues/bulk", body);

export const commentIssue = (id: string, body: string) =>
  v2Send<{ ok: boolean }>("POST", `/issues/${encodeURIComponent(id)}/comments`, { body });

export const exportIssues = (q: IssueQuery) => v2Download("/issues/export", { format: "xlsx", ...params({ ...q, limit: undefined, offset: undefined }) }, "issues.xlsx");
