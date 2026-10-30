/**
 * Step 10 clients: policy packs, scheduled digests, sandbox mode, record history and time travel, run prediction with
 * the queue position, and the command line's natural language mode. Every read goes through v2Get and every write
 * through v2Send, so fixture mode answers them from lib/api/v2/fixtures/step10.ts.
 *
 * Endpoints (api/routes/policy_packs.py, digests.py, sandbox.py, record_history.py, run_predict.py, command.py):
 *   GET /policy-packs, POST /policy-packs/{id}/apply, /unapply, GET /policy-packs/{id}/evidence?run=
 *   GET, POST /digests, GET, PATCH, DELETE /digests/{id}, POST /digests/{id}/send-now, GET /digests/{id}/deliveries,
 *   GET /digests/{id}/preview (HTML), GET /digests/{id}/preview.json
 *   GET /admin/sandbox, POST /admin/sandbox/enter, POST /admin/sandbox/exit
 *   GET /work/records/{module}/{key}/history, GET /objects/{module}/as-of?run=
 *   GET /runs/predict?system_id=&modules=&delta=
 *   GET /command/nl?q=
 * A field the backend does not return is not here; the screens show a dash for a null.
 */
import apiClient from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { v2Get, v2Send } from "./client";
import { fixtureResponse } from "./fixtures";
import type { DimensionKey } from "./types";

// ── policy packs ─────────────────────────────────────────────────────────────

export interface PolicyCoverage {
  fields_classified: number;
  rules_evidencing: number;
  rules_measured: number;
  failing_records: number;
  classes_breached: number;
}

export interface PolicyClass {
  id: string;
  label: string;
  /** The article or section the class answers to, as text. */
  authority: string;
  fields: string[];
  rules_count: number;
  rules_measured: number;
  pass_rate: number | null;
  failing_records: number;
  breached: boolean;
}

export interface PolicyPack {
  id: string;
  name: string;
  authority: string;
  description: string;
  applied: boolean;
  applied_at: string | null;
  applied_by: string | null;
  unapplied_at: string | null;
  coverage: PolicyCoverage;
  classes: PolicyClass[];
}

export interface PolicyRuleEvidence {
  check_id: string;
  measured: boolean;
  module: string | null;
  severity: string | null;
  pass_rate: number | null;
  failing_records: number;
  total_records: number;
}

export interface PolicyEvidence {
  pack_id: string;
  name: string;
  authority: string;
  applied: boolean;
  /** "run" or "current" */
  scope: string;
  run_id: string | null;
  classes: (PolicyClass & { rules: PolicyRuleEvidence[] })[];
  coverage: PolicyCoverage;
}

/** One breached class on the object receipt: an applied class with a failing critical rule of the object. */
export interface PolicyBreachClass {
  pack_id: string;
  class_id: string;
  label: string;
  authority: string;
  /** The class's critical rules failing in this run. */
  rules: string[];
}

const packPath = (id: string) => `/policy-packs/${encodeURIComponent(id)}`;
export const listPolicyPacks = (): Promise<{ packs: PolicyPack[]; applied: number }> => v2Get("/policy-packs");
export const applyPolicyPack = (id: string): Promise<{ id: string; applied: boolean; classes?: number }> => v2Send("POST", `${packPath(id)}/apply`);
export const unapplyPolicyPack = (id: string): Promise<{ id: string; applied: boolean }> => v2Send("POST", `${packPath(id)}/unapply`);
export const getPolicyEvidence = (id: string, run?: string | null): Promise<PolicyEvidence> => v2Get(`${packPath(id)}/evidence`, { run: run ?? undefined });

// ── digests ──────────────────────────────────────────────────────────────────

export type DigestAudience = "role" | "wave";
export type DigestChannel = "email" | "webhook" | "alert_channel";

export interface DigestBody {
  name: string;
  audience: DigestAudience;
  role?: string | null;
  wave_id?: string | null;
  cron: string;
  timezone: string;
  channel: DigestChannel;
  recipients: string[];
  recipient_user_ids: string[];
  alert_channel_id?: string | null;
  attach_pdf: boolean;
  enabled: boolean;
}

export interface Digest {
  id: string;
  name: string;
  audience: DigestAudience;
  role: string | null;
  wave_id: string | null;
  cron: string;
  timezone: string;
  channel: DigestChannel;
  recipients: string[];
  recipient_user_ids: string[];
  alert_channel_id: string | null;
  attach_pdf: boolean;
  enabled: boolean;
  last_sent_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DigestSend {
  delivery_id: string | null;
  /** sent, partial, failed or skipped */
  status: string;
  reason: string | null;
  delivered: number;
  failed: number;
}

export interface DigestDelivery {
  id: string;
  due_at: string | null;
  manual: boolean;
  status: string;
  reason: string | null;
  delivered: number;
  failed: number;
  created_at: string;
  finished_at: string | null;
}

/** GET /digests/{id}/preview.json: the numbers the digest is rendered from (api/services/digests.build). */
export interface DigestNumbers {
  schedule_id: string | null;
  name: string;
  audience: string | null;
  role: string | null;
  wave_id: string | null;
  tenant: string;
  currency: string;
  generated_at: string;
  landscape: { held_under_85: number; objects: number; critical_over_tolerance: number; release_if_fixed: string[]; released: number; text: string };
  score_moves: { system: string; module: string; before: number; after: number; delta: number }[];
  waves: { id: string; name: string; modules: string[]; target_date: string | null; gate_open: boolean; failing: string[] }[];
  approvals_waiting: number;
  sla_breaches: number;
  value_at_risk: { total: number | null; top: { check_id: string; module: string; cost_at_risk: number; failing_records: number }[] };
}

const digestPath = (id: string) => `/digests/${encodeURIComponent(id)}`;
export const listDigests = (): Promise<{ digests: Digest[] }> => v2Get("/digests");
export const getDigest = (id: string): Promise<Digest> => v2Get(digestPath(id));
export const createDigest = (body: DigestBody): Promise<Digest> => v2Send("POST", "/digests", body);
export const updateDigest = (id: string, body: Partial<DigestBody>): Promise<Digest> => v2Send("PATCH", digestPath(id), body);
export const deleteDigest = (id: string): Promise<void> => v2Send("DELETE", digestPath(id));
export const sendDigestNow = (id: string): Promise<DigestSend> => v2Send("POST", `${digestPath(id)}/send-now`);
export const listDigestDeliveries = (id: string): Promise<{ deliveries: DigestDelivery[] }> => v2Get(`${digestPath(id)}/deliveries`);
export const getDigestNumbers = (id: string): Promise<DigestNumbers> => v2Get(`${digestPath(id)}/preview.json`);

/** GET /digests/{id}/preview: the digest as its email would read now, as HTML text for a sandboxed frame. */
export async function getDigestHtml(id: string): Promise<string> {
  if (fixtureActive()) return fixtureResponse<string>(`${digestPath(id)}/preview`, {});
  const { data } = await apiClient.get<string>(`/api/v1${digestPath(id)}/preview`, { responseType: "text", transformResponse: (x: unknown) => x });
  return typeof data === "string" ? data : String(data);
}

// ── sandbox mode ─────────────────────────────────────────────────────────────

export interface SandboxState {
  sandbox: boolean;
  since: string | null;
  by: string | null;
  /** The sandbox runs, newest first. */
  runs: string[];
  /** Deliveries held back since the sandbox started (notifications, webhooks, digests, mailouts, write-backs). */
  skipped_deliveries: number;
}

export interface SandboxEntered extends SandboxState {
  source_run_id: string | null;
  sandbox_run_id: string | null;
  /** Rows copied per table. */
  copied: Record<string, number>;
}

export interface SandboxExited extends SandboxState {
  /** Rows discarded per table. */
  discarded: Record<string, number>;
}

export const getSandbox = (): Promise<SandboxState> => v2Get("/admin/sandbox");
export const enterSandbox = (copyRun = true): Promise<SandboxEntered> => v2Send("POST", "/admin/sandbox/enter", { copy_run: copyRun });
export const exitSandbox = (): Promise<SandboxExited> => v2Send("POST", "/admin/sandbox/exit");

// ── record history and time travel ───────────────────────────────────────────

export interface HistoryRun {
  run_id: string;
  run_at: string;
  label: string | null;
  system_id: string | null;
  sandbox: boolean;
  failing: boolean;
  checks: string[];
  /** The failing fields' values in that run: TABLE.FIELD to value. */
  values: Record<string, string | null>;
  /** The record's work status on that run's row (today's). */
  work_status: string | null;
  severity: string | null;
}

export interface HistoryEvent {
  at: string | null;
  /** issue, fix_proposed, batch, fix_approved or fix_sent */
  kind: string;
  action: string | null;
  check_id: string | null;
  run_id: string | null;
  scope: string | null;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  by: string | null;
  batch_id: string | null;
  batch_status: string | null;
}

export interface RecordHistory {
  module: string;
  record_key: string;
  name: string | null;
  systems: string[];
  /** Oldest first. */
  runs: HistoryRun[];
  events: HistoryEvent[];
}

export interface AsOfRule {
  check_id: string;
  severity: string;
  dimension: string | null;
  failing: number;
  total: number;
  pass_rate: number | null;
}

export interface ObjectAsOf {
  module: string;
  as_of_run: string;
  as_of_at: string;
  /** The object's newest run at or before the as-of run. */
  run_id: string;
  run_at: string;
  system_id: string | null;
  score: number | null;
  raw_score: number | null;
  capped: boolean;
  cap_level: number | null;
  breaches: string[];
  dimensions: Partial<Record<DimensionKey, number>>;
  records_checked: number | null;
  failing_records: number;
  rules: AsOfRule[];
}

export const getRecordHistory = (module: string, key: string, system?: string | null, limit = 50): Promise<RecordHistory> =>
  v2Get(`/work/records/${encodeURIComponent(module)}/${encodeURIComponent(key)}/history`, { system: system ?? undefined, limit });
export const getObjectAsOf = (module: string, run: string): Promise<ObjectAsOf> => v2Get(`/objects/${encodeURIComponent(module)}/as-of`, { run });

// ── run prediction ───────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low" | "none";

export interface ObjectPrediction {
  module: string;
  /** Past runs the prediction reads (at most 8). */
  runs: number;
  records: number | null;
  seconds: number | null;
  seconds_low: number | null;
  seconds_high: number | null;
  confidence: Confidence;
  /** full, delta or "full (no delta run yet)" */
  basis: string;
}

export interface RunPrediction {
  system_id: string | null;
  modules: string[];
  delta: boolean;
  objects: ObjectPrediction[];
  total: { records: number | null; seconds: number | null; seconds_low: number | null; seconds_high: number | null; confidence: Confidence };
  cost: { amount: number | null; low: number | null; high: number | null; currency: string; per_hour: number | null; per_million_records: number | null } | null;
  queue: { broker: Record<string, number>; waiting: number; running_jobs: number; queued_jobs: number; position: number };
}

export const getRunPrediction = (q: { system_id?: string | null; modules?: readonly string[]; delta?: boolean }): Promise<RunPrediction> =>
  v2Get("/runs/predict", { system_id: q.system_id ?? undefined, modules: q.modules && q.modules.length ? q.modules.join(",") : undefined, delta: q.delta ? true : undefined });

// ── natural language ─────────────────────────────────────────────────────────

export interface NlMatch {
  phrase: string;
  /** The ledger filter the phrase fills: module, severity, status, due, assigned, proposed, system, policy, check_id. */
  slot: string;
  value: string | boolean;
  label: string;
}

export interface NlAnswer {
  /** The parameters GET /work/records accepts. */
  filter: Record<string, string | boolean>;
  /** The Work ledger with the filter in its query string. */
  href: string;
  explanation: string;
  unmatched_words: string[];
  matched: NlMatch[];
  llm_used: boolean;
}

export const getNl = (q: string): Promise<NlAnswer> => v2Get("/command/nl", { q });
