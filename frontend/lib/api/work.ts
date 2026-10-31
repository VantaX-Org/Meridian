// The steward work list (api/routes/work.py): what fails in a run, record by record, and the decisions on it.
// Without a run the reads ask for the current state (`scope=current`): every object at its own latest complete run,
// the scope Home shows. Each object, group and record then names the run it was found in, the run its decisions go to.
import apiClient from "./client";
import { downloadBlob } from "./download";

/** The run to read, or (none) the current state. */
const scoped = (version_id?: string) => (version_id ? { version_id } : { scope: "current" as const });

export type WorkStatus = "to_fix" | "proposed" | "approved" | "awaiting_load" | "sent" | "not_an_issue" | "fixed";
export type WorkSeverity = "critical" | "high" | "medium" | "low" | "info";
export type WorkAction = "accept" | "edit" | "not_an_issue" | "accept_risk" | "undo" | "assign" | "comment";

export interface WorkObject {
  module: string;
  /** The run the object's records were found in. */
  version_id?: string;
  records: number;
  open: number;
  issues: number;
  critical: number;
  proposed: number;
  overdue: number;
  statuses: Partial<Record<WorkStatus, number>>;
}

export interface WorkSummary {
  /** The run read; null for the current state. */
  version_id: string | null;
  scope: string | null;
  /** "current": every object at its own latest run. */
  mode?: "run" | "current";
  /** The runs read: the one run, or the runs behind the current state. */
  version_ids?: string[];
  /** Runs read whose work list is not built yet (from before the work list): offer to build them. */
  unbuilt?: string[];
  /** False when no run read has a work list. */
  built: boolean;
  objects: WorkObject[];
  totals: { records: number; open: number; issues: number; critical: number; proposed: number; overdue: number };
}

export interface WorkGroup {
  check_id: string;
  module: string;
  /** The run the check failed in. */
  version_id?: string;
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
  /** The run the record failed in: its panel and decisions read that run. */
  version_id?: string;
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
  /** When the oldest of its failing issues was first seen: the record's age in the queue. */
  first_seen_at?: string | null;
  /** The first suggested value of its checks, in check order; null when none has one. */
  suggested_value?: string | null;
}

export interface WorkSuggestion {
  value: string;
  source: "rule" | "value_map" | "cleaning";
  confidence: string | null;
  why: string | null;
}

/** The rule behind an issue: its library row (opens /rules/<id>), name, dimension, authority and money at risk. */
export interface WorkIssueRule {
  id: string | null;
  name: string | null;
  dimension: string | null;
  authority: string | null;
  cost_at_risk: number | null;
  cost_per_record: number | null;
}

export interface WorkAllowedValue {
  value: string;
  label: string | null;
}

/** The detail fields (rule to allowed_values) are optional: a server from before them leaves them out. */
export interface WorkIssue {
  rule?: WorkIssueRule;
  /** Records failing this check in the run, this one included. */
  failing?: number;
  /** Other records failing the same check in the run. */
  others_failing?: number;
  /** Records the check read in the run. */
  population?: number | null;
  /** Percent of the population that passes, 0 to 100. */
  pass_rate?: number | null;
  /** The values the rule accepts, when it lists them. */
  allowed_values?: WorkAllowedValue[] | null;
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
  /** The record in the system's previous kept run; null when there is none. */
  other_runs?: WorkPreviousRun | null;
  /** The golden record keyed by this record, when MDM holds one. */
  golden_record?: { id: string; status: string; key: string; href: string } | null;
  /** Open duplicate candidates naming this record; null when they could not be counted. */
  duplicates?: { open: number; href: string } | null;
  /** The currency rule.cost_at_risk is priced in; null when no issue carries a cost. */
  currency?: string | null;
  can: { fix: boolean; sign_off: boolean; assign: boolean; comment: boolean };
}

export interface WorkPreviousRun {
  version_id: string;
  run_at: string | null;
  /** False: the record was not on that run's work list (it passed). */
  on_list: boolean;
  issues: number;
  status: WorkStatus | null;
  checks: string[];
  fixed_since: string[];
  new_since: string[];
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
  /** Source system scope of the run. */
  system?: string;
  /** One part of the record key, FIELD=VALUE (BUKRS=1000): one company code, plant or sales org. */
  part?: string;
  /** A baseline run id: only records failing a check they did not fail in that run (the monitoring strip's new failing records). Needs one run. */
  since?: string;
  q?: string;
  /** One fix batch, a policy pack (or pack:class) and the order of /work/records; the exports take them too. */
  batch_id?: string;
  policy?: string;
  sort?: string;
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

/** With `filter`, `totals` count the records GET /work/records lists for the same filter (status defaults to open). */
export async function getWorkSummary(version_id?: string, filter?: Omit<RecordFilter, "version_id">): Promise<WorkSummary> {
  const { data } = await apiClient.get("/api/v1/work/summary", { params: filter ? clean({ ...filter, ...scoped(version_id) }) : scoped(version_id) });
  return data;
}

export async function getWorkGroups(f: { version_id?: string; module?: string; severity?: string; proposed?: boolean; q?: string } = {}):
  Promise<{ version_id: string | null; built: boolean; total: number; groups: WorkGroup[] }> {
  const { data } = await apiClient.get("/api/v1/work/groups", { params: clean({ ...f, ...scoped(f.version_id) }) });
  return data;
}

/** `sort`: severity and/or age, comma separated, a leading minus for descending (`-age` is the oldest first). */
export async function getWorkRecords(f: RecordFilter & { after?: string; limit?: number; sort?: string }):
  Promise<{ version_id: string | null; total: number; total_capped: boolean; next: string | null; items: WorkRecord[] }> {
  const { data } = await apiClient.get("/api/v1/work/records", { params: clean({ ...f, ...scoped(f.version_id) }) });
  return data;
}

export async function getWorkRecord(module: string, recordKey: string, version_id?: string): Promise<WorkRecordDetail> {
  const { data } = await apiClient.get(`/api/v1/work/records/${encodeURIComponent(module)}/${encodeURIComponent(recordKey)}`,
    { params: clean({ version_id }) });
  return data;
}

export async function searchWork(q: string, version_id?: string):
  Promise<{ version_id: string | null; items: Pick<WorkRecord, "module" | "version_id" | "record_key" | "name" | "issues" | "status" | "severity">[] }> {
  const { data } = await apiClient.get("/api/v1/work/search", { params: clean({ q, ...scoped(version_id) }) });
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
  await downloadBlob("/api/v1/work/export", clean({ ...f, ...scoped(f.version_id) }), "fix-sheet.xlsx");
}

/** One workbook, a sheet per object, with each record's value at risk. */
export async function downloadFixSheetByObject(f: RecordFilter): Promise<void> {
  await downloadBlob("/api/v1/work/export/per-object", clean({ ...f, ...scoped(f.version_id) }), "records-to-fix-by-object.xlsx");
}

export async function importFixSheet(file: File, version_id?: string):
  Promise<{ updated: number; rows: number; skipped: string[]; draft_batch_id?: string | null }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post("/api/v1/work/import", form, {
    params: scoped(version_id), headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
