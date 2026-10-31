import { v2Get, v2Send } from "./client";

export type TriageSeverity = "critical" | "high" | "medium" | "low";

/** One row of GET /triage/sla-policies; a severity with no policy of its own shows the built-in default (`is_default`). */
export interface SlaPolicy {
  id: string | null;
  severity: TriageSeverity;
  module: string | null;
  ack_minutes: number | null;
  resolve_minutes: number;
  at_risk_pct: number;
  business_hours: boolean;
  is_default?: boolean;
}

export type Digest = "daily" | "weekly" | "off";

export const getSlaPolicies = (): Promise<SlaPolicy[]> => v2Get("/triage/sla-policies");
/** PUT /triage/sla-policies: creates or replaces the tenant-wide policy of one severity. Needs manage_triage, manage_settings or manage_rules. */
export const putSlaPolicy = (p: Omit<SlaPolicy, "id" | "is_default">): Promise<SlaPolicy> => v2Send("PUT", "/triage/sla-policies", p);
/** GET /me/preferences: the digest the signed-in person chose lives in notifications.digest. */
export const getPreferences = (): Promise<{ notifications?: { digest?: Digest } }> => v2Get("/me/preferences");
/** PATCH /me/preferences (a merge patch): sets the signed-in person's digest. */
export const patchDigest = (digest: Digest): Promise<{ notifications?: { digest?: Digest } }> => v2Send("PATCH", "/me/preferences", { notifications: { digest } });

/** GET /users/assignable: active users work can be assigned to. */
export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}
export const getAssignable = (): Promise<AssignableUser[]> => v2Get("/users/assignable");

// Queue, bulk actions, metrics, teams and assignment rules (api/routes/triage.py) -----------------------------------

export interface QueueItem {
  kind: "issue" | "queue";
  id: string;
  module: string | null;
  check_id: string | null;
  severity: string | null;
  status: string | null;
  ref: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  priority: number | null;
  sla_state: string | null;
  due_at: string | null;
  ack_due_at: string | null;
  acknowledged_at: string | null;
  sla_paused_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  /** Severity weight times affected records times (1 + features the rule blocks); a score, not money. */
  impact: number;
  /** Share of the SLA window used, 0 to 1. */
  urgency: number;
  /** impact × (1 + 2 × urgency): the order within a bucket after priority. */
  rank_score: number;
}
export interface QueueBucket { count: number; items: QueueItem[] }
export interface TriageQueue { assignee: string; as_of: string; overdue: QueueBucket; due_today: QueueBucket; later: QueueBucket }
/** GET /triage/queue: `assignee` is me, unassigned, all, a user id or team:<id>. Needs view. */
export const getTriageQueue = (assignee: string, include_snoozed: boolean): Promise<TriageQueue> =>
  v2Get("/triage/queue", { assignee, include_snoozed: include_snoozed || undefined, limit: 200 });

export type BulkAction = "assign" | "reassign" | "release" | "snooze" | "unsnooze" | "priority" | "acknowledge" | "wait" | "resume";
export interface BulkBody {
  kind: "issue" | "queue";
  ids: string[];
  action: BulkAction;
  user_id?: string;
  team_id?: string;
  reason?: string;
  until?: string;
  priority?: number;
  waiting?: "waiting_sap" | "waiting_requester";
  note?: string;
}
/** POST /triage/bulk: needs assign. Snooze needs a reason and a future time; assign and reassign need a user or a team. */
export const bulkTriage = (b: BulkBody): Promise<{ action: string; updated: number }> => v2Send("POST", "/triage/bulk", b);

export interface TriageMetrics {
  weeks: number;
  backlog_by_owner: { user_id: string; email: string | null; open: number; breached: number; at_risk: number }[];
  backlog_by_team: { team_id: string; name: string; open: number; breached: number; at_risk: number }[];
  unassigned: number;
  resolved_in_sla: number;
  resolved_total: number;
  sla_attainment_pct: number | null;
  mtta_hours: number | null;
  mttr_hours: number | null;
  breach_count: number;
  weekly: { week: string; opened: number; resolved: number; resolved_in_sla: number; breached: number }[];
}
export const getTriageMetrics = (weeks = 8): Promise<TriageMetrics> => v2Get("/triage/metrics", { weeks });

export interface Team { id: string; name: string; strategy: "round_robin" | "least_loaded"; lead_user_id: string | null; member_ids: string[]; open_items: number }
export const getTeams = (): Promise<Team[]> => v2Get("/triage/teams");
export const createTeam = (b: { name: string; strategy: Team["strategy"]; member_ids: string[] }): Promise<Team> => v2Send("POST", "/triage/teams", b);
export const setTeamMembers = (id: string, user_ids: string[]): Promise<Team> => v2Send("PUT", `/triage/teams/${encodeURIComponent(id)}/members`, { user_ids });
export const deleteTeam = (id: string): Promise<unknown> => v2Send("DELETE", `/triage/teams/${encodeURIComponent(id)}`);

export interface AssignRule {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  match: { module?: string[]; check_id?: string[]; severity?: string[]; dimension?: string[]; company_code?: string[]; plant?: string[]; sales_org?: string[] };
  assign_user_id: string | null;
  assign_team_id: string | null;
  updated_at: string | null;
}
export const getAssignRules = (): Promise<AssignRule[]> => v2Get("/triage/rules");
export const createAssignRule = (b: { name: string; match: AssignRule["match"]; assign_user_id?: string; assign_team_id?: string; enabled: boolean }): Promise<AssignRule> =>
  v2Send("POST", "/triage/rules", b);
/** PATCH /triage/rules/{id} replaces the whole rule, so the switch sends the rule back with only `enabled` changed. */
export const setAssignRuleEnabled = (r: AssignRule, enabled: boolean): Promise<AssignRule> =>
  v2Send("PATCH", `/triage/rules/${encodeURIComponent(r.id)}`, { name: r.name, match: r.match, assign_user_id: r.assign_user_id ?? undefined, assign_team_id: r.assign_team_id ?? undefined, enabled });
export const deleteAssignRule = (id: string): Promise<unknown> => v2Send("DELETE", `/triage/rules/${encodeURIComponent(id)}`);
