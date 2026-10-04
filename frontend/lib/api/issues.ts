import apiClient from "./client";
import { downloadBlob } from "./download";

export type IssueStatus =
  | "open"
  | "in_progress"
  | "waiting_sap"
  | "waiting_requester"
  | "accepted"
  | "resolved";

export type SlaState = "on_track" | "at_risk" | "breached";

export interface RecordIssue {
  id: string;
  scope: string;
  module: string;
  check_id: string;
  /** SAP record key, e.g. "LIFNR=0000100001|BUKRS=1000". */
  record_key: string;
  grain: string | null;
  severity: string;
  status: IssueStatus;
  resolution: string | null;
  assigned_to: string | null;
  assignee_email: string | null;
  first_seen_version: string;
  last_seen_version: string;
  resolved_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  reopened_count: number;
  message: string | null;
  field: string | null;
  /** Manual priority 1 (highest) to 5; null = derived from severity. */
  priority: number | null;
  assigned_team_id: string | null;
  acknowledged_at: string | null;
  due_at: string | null;
  ack_due_at: string | null;
  risk_at: string | null;
  sla_state: SlaState | null;
  /** Set while the item waits on SAP or the requester; the SLA clock is stopped. */
  sla_paused_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
}

export interface IssueEvent {
  action:
    | "status"
    | "assign"
    | "comment"
    | "auto_resolved"
    | "reopened"
    | "snooze"
    | "unsnooze"
    | "priority"
    | "acknowledge"
    | "sla_at_risk"
    | "sla_ack_breached"
    | "sla_breached";
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  user_label: string | null;
  version_id: string | null;
  created_at: string;
}

export interface IssueFilter {
  status?: IssueStatus;
  module?: string;
  check_id?: string;
  severity?: string;
  assigned_to?: string;
  scope?: string;
  search?: string;
  /** Only records failing in this version. */
  version_id?: string;
}

export async function getIssues(
  params: IssueFilter & { limit?: number; offset?: number }
): Promise<{ total: number; counts: Partial<Record<IssueStatus, number>>; items: RecordIssue[] }> {
  return (await apiClient.get("/api/v1/issues", { params })).data;
}

export async function getIssue(id: string): Promise<{
  issue: RecordIssue;
  events: IssueEvent[];
  runs: { version_id: string; run_at: string; failing: boolean }[];
}> {
  return (await apiClient.get(`/api/v1/issues/${id}`)).data;
}

export async function updateIssues(body: {
  ids: string[];
  status?: IssueStatus;
  resolution?: string;
  assigned_to?: string;
  note?: string;
}): Promise<{ updated: number }> {
  return (await apiClient.post("/api/v1/issues/bulk", body)).data;
}

export async function commentIssue(id: string, text: string): Promise<void> {
  await apiClient.post(`/api/v1/issues/${id}/comments`, { body: text });
}

export function exportIssues(format: "csv" | "xlsx", filter: IssueFilter): Promise<void> {
  return downloadBlob("/api/v1/issues/export", { format, ...filter }, `record_issues.${format}`);
}
