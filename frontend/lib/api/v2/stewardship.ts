/**
 * Stewardship queue (api/routes/stewardship.py): the items a steward works, with their SLA, the AI's recommendation and
 * its confidence. Reads need view; assign, approve, reject and bulk approve need approve (the route checks it).
 *
 * GET /stewardship, GET /stewardship/metrics, PUT /stewardship/{id}/assign, PUT /stewardship/{id}/resolve,
 * PUT /stewardship/{id}/escalate, POST /stewardship/bulk-approve.
 */
import { v2Get, v2Send } from "./client";

const enc = encodeURIComponent;

export const STEWARD_STATUSES = ["open", "in_progress", "escalated", "resolved", "rejected"] as const;
export const STEWARD_PAGE = 50;

export interface StewardItem {
  id: string;
  tenant_id: string;
  item_type: string;
  source_id: string;
  domain: string;
  priority: number;
  due_at: string | null;
  assigned_to: string | null;
  status: string;
  sla_hours: number;
  created_at: string;
  updated_at: string;
  ai_recommendation: string | null;
  ai_confidence: number | null;
  sla_state?: string | null;
  snoozed_until?: string | null;
  source_title?: string | null;
  source_check_id?: string | null;
  source_module?: string | null;
}

export interface StewardList { items: StewardItem[]; total: number }

export interface StewardMetrics {
  items_by_type: Record<string, number>;
  items_by_status: Record<string, number>;
  avg_resolution_hours_by_type: Record<string, number>;
  backlog_total: number;
  overdue_count: number;
  sla_compliance_rate: number;
  ai_acceptance_rate?: number | null;
  steward_breakdown?: Array<{ user_id: string; name?: string | null; open: number; resolved: number; overdue: number }> | null;
}

export interface StewardFilter { status?: string; item_type?: string; domain?: string; assigned_to?: string; priority?: number; offset?: number }

export const listStewardQueue = (f: StewardFilter = {}) =>
  v2Get<StewardList>("/stewardship", { status: f.status ?? "open", item_type: f.item_type, domain: f.domain, assigned_to: f.assigned_to, priority: f.priority, limit: STEWARD_PAGE, offset: f.offset ?? 0 });
export const getStewardMetrics = () => v2Get<StewardMetrics>("/stewardship/metrics");
export const assignStewardItem = (id: string, userId: string | null) =>
  v2Send<{ id: string; status: string; assigned_to: string | null }>("PUT", `/stewardship/${enc(id)}/assign`, { user_id: userId });
export const resolveStewardItem = (id: string, action: "approve" | "reject", notes?: string) =>
  v2Send<{ id: string; status: string; action: string }>("PUT", `/stewardship/${enc(id)}/resolve`, { action, notes: notes || undefined });
export const escalateStewardItem = (id: string) => v2Send<{ id: string; status: string }>("PUT", `/stewardship/${enc(id)}/escalate`, {});
export const bulkApproveSteward = (ids: string[], minConfidence = 0.85) =>
  v2Send<{ approved: number; history_rows_created: number }>("POST", "/stewardship/bulk-approve", { item_ids: ids, min_confidence: minConfidence });
