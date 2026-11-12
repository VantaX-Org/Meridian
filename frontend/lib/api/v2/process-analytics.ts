/**
 * Governance process analytics client (api/routes/process_analytics.py).
 *
 *   GET /governance/process-analytics   cycle time, approval time, step dwell, SLA breaches and backlog of change requests
 *
 * Every figure is counted from the tenant's change requests and workflow tasks. Percentiles are nearest-rank, so each
 * one is a real request or task.
 */
import { v2Get } from "./client";

export type RequestObject = "material" | "customer" | "vendor" | "business_partner";

export interface Spread { n: number; median_hours?: number | null; p90_hours?: number | null }

export interface ObjectRow {
  object: string;
  total: number;
  open: number;
  created: number;
  rejected: number;
  failed: number;
  cancelled: number;
  median_cycle_hours?: number | null;
  p90_cycle_hours?: number | null;
}

export interface Rates { closed: number; rejection?: number | null; failure?: number | null; cancellation?: number | null }

export interface Sla { with_sla: number; breached: number; rate?: number | null }

export interface StepRow {
  step: string;
  index: number;
  tasks: number;
  decided: number;
  pending: number;
  breached: number;
  overdue_open: number;
  median_dwell_hours?: number | null;
  p90_dwell_hours?: number | null;
}

export interface Aging { lt_1d: number; d1_3: number; d3_7: number; gt_7d: number }

export interface Week { week: string; submitted: number; created: number }

export interface ProcessAnalytics {
  days: number;
  total: number;
  by_status: Record<string, number>;
  objects: ObjectRow[];
  cycle: Spread;
  approval: Spread;
  rates: Rates;
  sla: Sla;
  steps: StepRow[];
  bottleneck?: string | null;
  aging: Aging;
  weekly: Week[];
}

export const getProcessAnalytics = (days = 90, object?: RequestObject): Promise<ProcessAnalytics> =>
  v2Get<ProcessAnalytics>("/governance/process-analytics", { days, ...(object ? { object } : {}) });

/** One decided task of the same step (and object and kind when enough exist) the forecast was read from. */
export interface ForecastEvidence { request_id: string; title?: string | null; dwell_hours: number; decided_at: string }

/** A step still ahead of the waiting one, with the median dwell of its history. */
export interface ForecastStep { step: string; index: number; basis: string; n: number; p50_hours?: number | null; sla_hours?: number | null }

export type ForecastBasis = "object_kind_step" | "step" | "none";

/** An open request's waiting step: when it is likely decided, and how likely it is to miss its SLA. */
export interface ForecastRow {
  request_id: string;
  title?: string | null;
  object: string;
  kind: string;
  status: string;
  object_key?: string | null;
  step: string;
  step_index: number;
  activated_at?: string | null;
  due_at?: string | null;
  sla_hours?: number | null;
  elapsed_hours: number;
  basis: string;
  conditioned: boolean;
  n: number;
  p50_hours?: number | null;
  p90_hours?: number | null;
  eta?: string | null;
  p90_eta?: string | null;
  breach_probability?: number | null;
  breached: boolean;
  remaining: ForecastStep[];
  request_eta?: string | null;
  evidence: ForecastEvidence[];
}

export interface ApprovalForecast { open: number; without_pending: number; at_risk: number; breached: number; requests: ForecastRow[] }

export const getApprovalForecast = (days = 365): Promise<ApprovalForecast> =>
  v2Get<ApprovalForecast>("/governance/approval-forecast", { days });
