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
