/**
 * Cleansing client: what the cleaning engine proposed, applied and rolled back.
 *
 * Endpoints (api/routes/cleaning.py):
 *   GET  /cleaning/metrics?period_type=weekly  (one snapshot per week and object of the queue by status, newest first;
 *        the weekly cleaning task in workers/scheduler.py writes them, so the weekly series is the one that exists)
 *   GET  /cleaning/queue?status=applied        (the applied proposals; each can be rolled back until its deadline)
 *   GET  /cleaning/audit                       (every decision on a proposal, newest first; needs the export permission)
 *   POST /cleaning/rollback/{id}               (needs the apply permission)
 */
import { v2Get, v2Send } from "./client";

export interface CleaningMetric {
  period: string;
  period_type: string;
  object_type: string;
  detected: number;
  recommended: number;
  approved: number;
  rejected: number;
  applied: number;
  verified: number;
  rolled_back: number;
  auto_approved: number;
}

export type RecordData = Record<string, unknown> | null;

export interface CleaningItem {
  id: string;
  object_type: string;
  status: string;
  record_key: string;
  applied_at: string | null;
  rollback_deadline: string | null;
  record_data_before: RecordData;
  record_data_after: RecordData;
}

export interface CleaningAudit {
  id: string;
  action: string;
  actor_name: string | null;
  record_key: string | null;
  object_type: string | null;
  created_at: string;
}

export const getCleaningMetrics = () => v2Get<{ metrics: CleaningMetric[] }>("/cleaning/metrics", { period_type: "weekly" });
export const getAppliedCleaning = () => v2Get<{ items: CleaningItem[]; total: number }>("/cleaning/queue", { status: "applied", per_page: 100 });
export const getCleaningAudit = () => v2Get<{ items: CleaningAudit[]; total: number }>("/cleaning/audit", { per_page: 25 });
export const rollbackCleaning = (id: string) => v2Send<{ id: string; status: string }>("POST", `/cleaning/rollback/${encodeURIComponent(id)}`);
