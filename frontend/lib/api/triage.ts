import apiClient from "./client";
import type { SlaState } from "./issues";

const BASE = "/api/v1/triage";

export type TriageSeverity = "critical" | "high" | "medium" | "low";
export type TriageKind = "issue" | "queue";
export type TeamStrategy = "round_robin" | "least_loaded";

export interface RuleMatch {
  module?: string[];
  check_id?: string[];
  severity?: TriageSeverity[];
  dimension?: string[];
  company_code?: string[];
  plant?: string[];
  sales_org?: string[];
}

export interface AssignmentRuleInput {
  name: string;
  match?: RuleMatch;
  /** Exactly one of assign_user_id / assign_team_id. */
  assign_user_id?: string | null;
  assign_team_id?: string | null;
  enabled?: boolean;
  position?: number;
}

export interface AssignmentRule {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  match: RuleMatch;
  assign_user_id: string | null;
  assign_team_id: string | null;
  updated_at: string | null;
}

export interface TriageTeamInput {
  name: string;
  strategy?: TeamStrategy;
  lead_user_id?: string | null;
  member_ids?: string[];
}

export interface TriageTeam {
  id: string;
  name: string;
  strategy: TeamStrategy;
  lead_user_id: string | null;
  member_ids: string[];
  open_items: number;
}

export interface SlaPolicyInput {
  severity: TriageSeverity;
  module?: string | null;
  ack_minutes?: number | null;
  resolve_minutes: number;
  at_risk_pct?: number;
  business_hours?: boolean;
}

export interface SlaPolicy extends Required<SlaPolicyInput> {
  /** null for a built-in default that has not been saved. */
  id: string | null;
  is_default: boolean;
}

export interface TriageSettings {
  timezone: string;
  /** ISO weekdays, 1 = Monday. */
  work_days: number[];
  /** "HH:MM:SS" */
  work_start: string;
  work_end: string;
  /** ISO dates. */
  holidays: string[];
  fallback_user_id: string | null;
}

export type BulkAction =
  | "assign"
  | "reassign"
  | "snooze"
  | "unsnooze"
  | "priority"
  | "acknowledge"
  | "wait"
  | "resume";

export interface TriageBulkInput {
  kind: TriageKind;
  ids: string[];
  action: BulkAction;
  user_id?: string;
  team_id?: string;
  /** Required for snooze. */
  reason?: string;
  /** Snooze expiry, ISO datetime in the future. */
  until?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  waiting?: "waiting_sap" | "waiting_requester";
  note?: string;
}

export interface TriageBulkResult {
  action: BulkAction;
  updated: number;
  /** wait / resume: { paused, resumed }; assign / reassign: SLA clocks started per kind. */
  sla: Record<string, number>;
}

export interface TriageQueueItem {
  kind: TriageKind;
  id: string;
  module: string | null;
  check_id: string | null;
  severity: string;
  status: string;
  /** Record key (issues) or item type (queue). */
  ref: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  priority: number | null;
  sla_state: SlaState | null;
  due_at: string | null;
  ack_due_at: string | null;
  acknowledged_at: string | null;
  sla_paused_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  impact: number;
  urgency: number;
  rank_score: number;
}

export interface TriageBucket {
  count: number;
  items: TriageQueueItem[];
}

export interface TriageQueue {
  assignee: string;
  as_of: string;
  overdue: TriageBucket;
  due_today: TriageBucket;
  later: TriageBucket;
}

export interface BacklogRow {
  open: number;
  breached: number;
  at_risk: number;
}

export interface TriageMetrics {
  weeks: number;
  backlog_by_owner: (BacklogRow & { user_id: string; email: string })[];
  backlog_by_team: (BacklogRow & { team_id: string; name: string })[];
  unassigned: number;
  resolved_in_sla: number;
  resolved_total: number;
  sla_attainment_pct: number | null;
  mtta_hours: number | null;
  mttr_hours: number | null;
  breach_count: number;
  weekly: { week: string; opened: number; resolved: number; resolved_in_sla: number; breached: number }[];
}

/** "me", a user id, "team:<id>", "unassigned" or "all". */
export async function getTriageQueue(params?: {
  assignee?: string;
  include_snoozed?: boolean;
  limit?: number;
}): Promise<TriageQueue> {
  return (await apiClient.get<TriageQueue>(`${BASE}/queue`, { params })).data;
}

export async function bulkTriage(body: TriageBulkInput): Promise<TriageBulkResult> {
  return (await apiClient.post<TriageBulkResult>(`${BASE}/bulk`, body)).data;
}

export async function getTriageMetrics(weeks = 8): Promise<TriageMetrics> {
  return (await apiClient.get<TriageMetrics>(`${BASE}/metrics`, { params: { weeks } })).data;
}

export async function getTeams(): Promise<TriageTeam[]> {
  return (await apiClient.get<TriageTeam[]>(`${BASE}/teams`)).data;
}

export async function createTeam(body: TriageTeamInput): Promise<TriageTeam> {
  return (await apiClient.post<TriageTeam>(`${BASE}/teams`, body)).data;
}

export async function updateTeam(id: string, body: Partial<Omit<TriageTeamInput, "member_ids">>): Promise<TriageTeam> {
  return (await apiClient.patch<TriageTeam>(`${BASE}/teams/${id}`, body)).data;
}

export async function setTeamMembers(id: string, user_ids: string[]): Promise<TriageTeam> {
  return (await apiClient.put<TriageTeam>(`${BASE}/teams/${id}/members`, { user_ids })).data;
}

export async function deleteTeam(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/teams/${id}`);
}

export async function getRules(): Promise<AssignmentRule[]> {
  return (await apiClient.get<AssignmentRule[]>(`${BASE}/rules`)).data;
}

export async function createRule(body: AssignmentRuleInput): Promise<AssignmentRule> {
  return (await apiClient.post<AssignmentRule>(`${BASE}/rules`, body)).data;
}

export async function updateRule(id: string, body: AssignmentRuleInput): Promise<AssignmentRule> {
  return (await apiClient.patch<AssignmentRule>(`${BASE}/rules/${id}`, body)).data;
}

export async function deleteRule(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/rules/${id}`);
}

/** Full ordered list of rule ids. */
export async function reorderRules(ids: string[]): Promise<AssignmentRule[]> {
  return (await apiClient.post<AssignmentRule[]>(`${BASE}/rules/reorder`, { ids })).data;
}

export async function getSlaPolicies(): Promise<SlaPolicy[]> {
  return (await apiClient.get<SlaPolicy[]>(`${BASE}/sla-policies`)).data;
}

/** Upsert by (severity, module). */
export async function saveSlaPolicy(body: SlaPolicyInput): Promise<SlaPolicy> {
  return (await apiClient.put<SlaPolicy>(`${BASE}/sla-policies`, body)).data;
}

export async function deleteSlaPolicy(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/sla-policies/${id}`);
}

export async function getTriageSettings(): Promise<TriageSettings> {
  return (await apiClient.get<TriageSettings>(`${BASE}/settings`)).data;
}

export async function saveTriageSettings(body: Partial<TriageSettings>): Promise<TriageSettings> {
  return (await apiClient.put<TriageSettings>(`${BASE}/settings`, body)).data;
}
