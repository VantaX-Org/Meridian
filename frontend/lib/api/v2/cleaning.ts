/**
 * Cleansing client: what the cleaning engine proposed, applied and rolled back.
 *
 * Endpoints (api/routes/cleaning.py):
 *   GET  /cleaning/metrics?period_type=weekly  (one snapshot per week and object of the queue by status, newest first;
 *        the weekly cleaning task in workers/scheduler.py writes them, so the weekly series is the one that exists)
 *   GET  /cleaning/queue?status=applied        (the applied proposals; each can be rolled back until its deadline)
 *   GET  /cleaning/audit                       (every decision on a proposal, newest first; needs the export permission)
 *   POST /cleaning/apply/{id}                  (marks an approved change as loaded in SAP; Meridian does not write to SAP
 *        here, and the approver cannot mark their own approval; needs the apply permission)
 *   POST /cleaning/rollback/{id}               (needs the apply permission)
 *   GET  /cleaning/export-options              (the objects and statuses in the queue with counts; needs export)
 *   GET  /cleaning/export/{format}?status=     (the load file: csv, xlsx, lsmw, bapi, idoc or sf_csv; needs export)
 *   GET  /cleaning/queue/safety                (each waiting proposal's new value checked against the SAP dictionary:
 *        safe or rejected by SAP with the reason, and totals)
 *   GET  /dedup/candidates                     (pairs the cleaning engine found to be the same record, still pending)
 *   POST /dedup/preview                        (the fields of both records side by side)
 *   POST /dedup/merge                          (keeps the survivor and merges the other into it; needs approve and a reason)
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import type { DdicEvidence } from "./dq-firewall";

export interface ExportOptions {
  object_types: { value: string; count: number }[];
  statuses: { value: string; count: number }[];
}
export const getExportOptions = (): Promise<ExportOptions> => v2Get("/cleaning/export-options");

export const EXPORT_FORMATS = ["csv", "xlsx", "lsmw", "bapi", "idoc", "sf_csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXT: Record<ExportFormat, string> = { csv: "csv", xlsx: "xlsx", lsmw: "txt", bapi: "json", idoc: "json", sf_csv: "csv" };
/** Saves the load file for one status, across all objects unless one is named. Returns the saved file name. */
export const exportCleaning = (format: ExportFormat, status: string, objectType?: string): Promise<string> =>
  v2Download(`/cleaning/export/${format}`, { status, object_type: objectType }, `cleaning-${status}-${objectType || "all"}.${EXT[format]}`);

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

/*
 * Proposals still waiting for a decision (api/routes/cleaning.py):
 *   GET  /cleaning/queue/groups                 (the waiting proposals by run, object and what they do)
 *   GET  /cleaning/queue?status=&version_id=&kind=  (one group's proposals, or the approved ones)
 *   POST /cleaning/approve/{id}  {notes?}       (needs approve)
 *   POST /cleaning/reject/{id}   {reason}       (needs approve)
 *   POST /cleaning/bulk-approve  {version_id?, kind?, min_confidence?}  (one group at or above a confidence)
 *   POST /cleaning/apply/{id}                   (an approved proposal; needs apply)
 *   POST /ai/feedback                           (a rejection teaches Aletheia; needs ai_feedback)
 */
export interface CleaningGroup {
  version_id: string | null;
  object_type: string;
  kind: string;
  rule_name: string | null;
  records: number;
  avg_confidence: number;
  confident: number;
  run_label: string | null;
  run_at: string | null;
}

export interface Proposal extends CleaningItem {
  confidence: number | null;
  version_id: string | null;
  rule_id: string | null;
  priority: number | null;
  detected_at: string | null;
  merge_preview: RecordData;
  /** Who approved it; that person cannot mark it loaded (the API answers 403). Null when the scheduler approved it. */
  approved_by?: string | null;
}

export const WAITING = "detected,recommended";
/** The confidence the groups count as confident, as the route does (0.85). */
export const CONFIDENT = 0.85;

/** One after-value of a waiting proposal, checked against the target system's ABAP Dictionary. */
export interface SafetyItem {
  id: string;
  record_key: string | null;
  object_type: string | null;
  /** The TABLE.FIELD checked; null when the key matched no single SAP field. */
  field: string | null;
  value: string | null;
  /** reject: SAP would refuse the value. unknown: not checked. */
  verdict: "safe" | "reject" | "unknown";
  reasons: string[];
  evidence?: DdicEvidence | null;
}

export interface SafetyReport {
  items: SafetyItem[];
  totals: { checked: number; safe: number; reject: number; unknown: number };
  /** More waiting proposals than the limit; only the first were checked. */
  truncated: boolean;
}

export const getCleaningSafety = () => v2Get<SafetyReport>("/cleaning/queue/safety");

export const getCleaningGroups = () => v2Get<{ groups: CleaningGroup[]; records: number; confident: number; runs: number }>("/cleaning/queue/groups");
export const getProposals = (p: { status: string; version_id?: string | null; kind?: string }) =>
  v2Get<{ items: Proposal[]; total: number }>("/cleaning/queue", { status: p.status, version_id: p.version_id ?? undefined, kind: p.kind, per_page: 50 });
const one = (verb: string, id: string, body?: unknown) => v2Send<{ id: string; status: string }>("POST", `/cleaning/${verb}/${encodeURIComponent(id)}`, body ?? {});
export const approveProposal = (id: string) => one("approve", id);
export const rejectProposal = (id: string, reason: string) => one("reject", id, { reason });
export const applyProposal = (id: string) => one("apply", id);
export const approveGroup = (g: Pick<CleaningGroup, "version_id" | "kind">, min_confidence: number) =>
  v2Send<{ approved_count: number }>("POST", "/cleaning/bulk-approve", { version_id: g.version_id ?? undefined, kind: g.kind, min_confidence });
export const sendAiFeedback = (queue_item_id: string, domain: string, correction_reason: string) =>
  v2Send<{ id: string; status: string }>("POST", "/ai/feedback", { queue_item_id, steward_decision: "reject", correction_reason, domain });

export interface DedupCandidate {
  id: string;
  object_type: string;
  record_key_a: string;
  record_key_b: string;
  match_score: number;
  match_method: string | null;
  match_fields: Record<string, { a?: string; b?: string; method?: string; score?: number }> | null;
  status: string;
  created_at: string | null;
}
export type MergePreview = Record<string, { a: string; b: string; survivor: string }>;

export const getDedupCandidates = () => v2Get<{ items: DedupCandidate[]; total: number }>("/dedup/candidates", { per_page: 50 });
export const previewDedup = (c: Pick<DedupCandidate, "record_key_a" | "record_key_b" | "object_type">) =>
  v2Send<{ merge_preview: MergePreview }>("POST", "/dedup/preview", { record_key_a: c.record_key_a, record_key_b: c.record_key_b, object_type: c.object_type });
export const mergeDedup = (candidate_id: string, survivor_key: string, reason: string) =>
  v2Send<{ status: string }>("POST", "/dedup/merge", { candidate_id, survivor_key, reason });
