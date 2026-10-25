// The steward work list (api/routes/work.py): what fails in a run, record by record, and the decisions on it.
import apiClient from "./client";
import { downloadBlob } from "./download";

export type WorkStatus = "to_fix" | "proposed" | "approved" | "sent" | "not_an_issue" | "fixed";
export type WorkSeverity = "critical" | "high" | "medium" | "low" | "info";
export type WorkAction = "accept" | "edit" | "not_an_issue" | "accept_risk" | "undo" | "assign" | "comment";

export interface WorkObject {
  module: string;
  records: number;
  open: number;
  issues: number;
  critical: number;
  proposed: number;
  overdue: number;
  statuses: Partial<Record<WorkStatus, number>>;
}

export interface WorkSummary {
  version_id: string;
  scope: string;
  /** False for a run from before the work list: offer to build it. */
  built: boolean;
  objects: WorkObject[];
  totals: { records: number; open: number; issues: number; critical: number; proposed: number; overdue: number };
}

export interface WorkGroup {
  check_id: string;
  module: string;
  severity: WorkSeverity;
  dimension: string | null;
  message: string | null;
  field: string | null;
  /** Records failing the check (the run's full count). */
  records: number;
  population: number | null;
  /** Records with a machine-proposed value. */
  proposed: number;
  /** The run kept only the first 100k failing keys of this check. */
  truncated: boolean;
  statuses: Partial<Record<WorkStatus, number>>;
  open: number;
}

export interface WorkRecord {
  module: string;
  record_key: string;
  name: string | null;
  issues: number;
  severity: WorkSeverity;
  checks: string[];
  proposed: number;
  status: WorkStatus;
  due_at: string | null;
  assigned_to: string | null;
  assignee_email: string | null;
  top_message: string | null;
  top_field: string | null;
}

export interface WorkSuggestion {
  value: string;
  source: "rule" | "value_map" | "cleaning";
  confidence: string | null;
  why: string | null;
}

export interface WorkIssue {
  check_id: string;
  severity: WorkSeverity;
  dimension: string | null;
  message: string;
  field: string | null;
  current_value: string | null;
  instruction: string | null;
  why_it_matters: string | null;
  sap_impact: string | null;
  suggestion: WorkSuggestion | null;
  status: WorkStatus;
  issue_id: string | null;
  resolution: string | null;
  first_seen_at: string | null;
  reopened_count: number;
  due_at: string | null;
  sla_state: string | null;
  decision: {
    batch_id: string;
    batch_status: string;
    batch_name: string;
    value: string | null;
    source: string | null;
    still_failing: boolean;
    at: string | null;
  } | null;
}

export interface WorkEvent {
  action: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  user_label: string | null;
  created_at: string | null;
  check_id: string;
}

export interface WorkRecordDetail {
  version_id: string;
  module: string;
  record_key: string;
  name: string | null;
  status: WorkStatus;
  assigned_to: string | null;
  assignee_email: string | null;
  values: Record<string, string | null>;
  issues: WorkIssue[];
  events: WorkEvent[];
  can: { fix: boolean; sign_off: boolean; assign: boolean; comment: boolean };
}

export interface RecordFilter {
  version_id?: string;
  module?: string;
  check_id?: string;
  severity?: string;
  status?: string;
  assigned?: string;
  proposed?: boolean;
  due?: "overdue" | "today";
  /** One part of the record key, FIELD=VALUE (BUKRS=1000): one company code, plant or sales org. */
  part?: string;
  q?: string;
}

export interface Decision {
  module: string;
  record_key: string;
  check_id?: string | null;
  action: WorkAction;
  value?: string;
  note?: string;
  assignee?: string;
}

const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));

export async function getWorkSummary(version_id?: string): Promise<WorkSummary> {
  const { data } = await apiClient.get("/api/v1/work/summary", { params: clean({ version_id }) });
  return data;
}

export async function getWorkGroups(f: { version_id?: string; module?: string; severity?: string; proposed?: boolean; q?: string } = {}):
  Promise<{ version_id: string; built: boolean; total: number; groups: WorkGroup[] }> {
  const { data } = await apiClient.get("/api/v1/work/groups", { params: clean(f) });
  return data;
}

export async function getWorkRecords(f: RecordFilter & { after?: string; limit?: number }):
  Promise<{ version_id: string; total: number; total_capped: boolean; next: string | null; items: WorkRecord[] }> {
  const { data } = await apiClient.get("/api/v1/work/records", { params: clean(f) });
  return data;
}

export async function getWorkRecord(module: string, recordKey: string, version_id?: string): Promise<WorkRecordDetail> {
  const { data } = await apiClient.get(`/api/v1/work/records/${encodeURIComponent(module)}/${encodeURIComponent(recordKey)}`,
    { params: clean({ version_id }) });
  return data;
}

export async function searchWork(q: string, version_id?: string):
  Promise<{ version_id: string; items: Pick<WorkRecord, "module" | "record_key" | "name" | "issues" | "status" | "severity">[] }> {
  const { data } = await apiClient.get("/api/v1/work/search", { params: clean({ q, version_id }) });
  return data;
}

export async function decide(items: Decision[], version_id?: string): Promise<{ updated: number; draft_batch_id: string | null }> {
  const { data } = await apiClient.post("/api/v1/work/decide", { version_id, items });
  return data;
}

export async function acceptAllInGroup(check_id: string, version_id?: string): Promise<{ accepted: number; draft_batch_id: string }> {
  const { data } = await apiClient.post(`/api/v1/work/groups/${encodeURIComponent(check_id)}/accept-all`, null,
    { params: clean({ version_id }) });
  return data;
}

export async function setGroupValue(check_id: string, value: string, only_blank: boolean, version_id?: string):
  Promise<{ updated: number; draft_batch_id: string }> {
  const { data } = await apiClient.post(`/api/v1/work/groups/${encodeURIComponent(check_id)}/set-value`,
    { value, only_blank }, { params: clean({ version_id }) });
  return data;
}

export async function buildWorklist(version_id?: string): Promise<{ version_id: string; queued: boolean }> {
  const { data } = await apiClient.post("/api/v1/work/build", null, { params: clean({ version_id }) });
  return data;
}

export async function downloadFixSheet(f: RecordFilter): Promise<void> {
  await downloadBlob("/api/v1/work/export", clean(f), "fix-sheet.xlsx");
}

export async function importFixSheet(file: File, version_id?: string):
  Promise<{ updated: number; rows: number; skipped: string[]; draft_batch_id?: string | null }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post("/api/v1/work/import", form, {
    params: clean({ version_id }), headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
