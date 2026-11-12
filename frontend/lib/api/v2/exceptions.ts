/**
 * Exceptions (api/routes/exceptions.py): what went wrong in a business process or an SAP transaction, raised by a rule
 * or by hand, worked under an SLA by severity, escalated through tiers and resolved with a root cause.
 *
 * GET /exceptions, GET /exceptions/{id}, PUT /exceptions/{id}/assign, PUT /exceptions/{id}/escalate,
 * PUT /exceptions/{id}/resolve, POST /exceptions/{id}/comment, GET /exceptions/sap-monitor, GET /exceptions/rules,
 * POST /exceptions, POST /exceptions/rules, PUT /exceptions/rules/{id}, GET /exceptions/metrics.
 */
import { v2Get, v2Send } from "./client";

const enc = encodeURIComponent;

export const EXCEPTION_STATUSES = ["open", "investigating", "pending_approval", "resolved", "verified", "closed"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
export const EXCEPTION_PAGE = 25;
/** The resolution types the route bills by: auto 1, steward 2, dedup or complex 3, custom rule 4. */
export const RESOLUTION_TYPES = ["steward", "auto_resolved", "dedup", "complex", "custom_rule"] as const;

export interface ExceptionRow {
  id: string;
  type: string;
  category: string | null;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  source_system: string | null;
  source_reference: string | null;
  affected_records: Record<string, unknown> | null;
  estimated_impact_zar: number | null;
  assigned_to: string | null;
  escalation_tier: number | null;
  sla_deadline: string | null;
  root_cause_category: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  linked_finding_id: string | null;
  created_at: string | null;
  resolved_at: string | null;
}

export interface ExceptionDetail extends ExceptionRow {
  comments: { id: string; user_name: string | null; text: string; created_at: string | null }[];
  linked_finding: { id: string; module: string; check_id: string; severity: string; dimension: string | null; pass_rate: number | null } | null;
}

export interface ExceptionMetrics {
  open_count: number;
  resolved_count: number;
  avg_resolution_hours: number;
  sla_compliance_pct: number;
  overdue_count: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface ExceptionRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string | null;
  object_type: string | null;
  condition: string | null;
  severity: string | null;
  auto_assign_to: string | null;
  is_active: boolean;
}

export const getExceptions = (q: { status: string; severity: string; type: string; page: number }) =>
  v2Get<{ exceptions: ExceptionRow[]; total: number; page: number; per_page: number }>("/exceptions", {
    status: q.status || undefined, severity: q.severity || undefined, type: q.type || undefined, page: q.page, per_page: EXCEPTION_PAGE,
  });
export const getException = (id: string) => v2Get<ExceptionDetail>(`/exceptions/${enc(id)}`);
export const getExceptionMetrics = () => v2Get<ExceptionMetrics>("/exceptions/metrics");
export const getSapMonitor = () => v2Get<{ exceptions: ExceptionRow[]; by_category: Record<string, ExceptionRow[]> }>("/exceptions/sap-monitor");
export const getExceptionRules = () => v2Get<{ rules: ExceptionRule[] }>("/exceptions/rules");
/** Needs assign (or manage_systems on an SAP-raised exception). An open exception moves to investigating. */
export const assignException = (id: string, user_id: string, user_name: string) => v2Send("PUT", `/exceptions/${enc(id)}/assign`, { user_id, user_name });
/** Needs approve. Moves the exception one tier up and resets its SLA. */
export const escalateException = (id: string, reason: string) =>
  v2Send<{ escalation_tier: number; sla_deadline: string }>("PUT", `/exceptions/${enc(id)}/escalate`, { reason });
export const resolveException = (id: string, b: { resolution_type: string; resolution_notes: string; root_cause_category: string }) =>
  v2Send("PUT", `/exceptions/${enc(id)}/resolve`, b);
export const commentException = (id: string, text: string, user_name: string) => v2Send("POST", `/exceptions/${enc(id)}/comment`, { text, user_name });
/** Needs manage_rules. A new rule is created inactive; this switches it on or off. */
export const setExceptionRuleActive = (id: string, is_active: boolean) => v2Send<ExceptionRule>("PUT", `/exceptions/rules/${enc(id)}`, { is_active });

/** Body of POST /exceptions. Needs analyse or run_process_discovery. The SAP-source fields are for system managers and are not offered here. */
export interface RaiseExceptionBody { type: string; category: string; severity: string; title: string; description: string }
export const raiseException = (b: RaiseExceptionBody) => v2Send<{ id: string; status: string }>("POST", "/exceptions", b);
/** Body of POST /exceptions/rules. Needs manage_rules. The rule is created inactive. */
export interface NewExceptionRuleBody { name: string; description: string; rule_type: string; object_type: string; condition: string; severity: string; auto_assign_to?: string }
export const createExceptionRule = (b: NewExceptionRuleBody) => v2Send<{ id: string; is_active: boolean }>("POST", "/exceptions/rules", b);
