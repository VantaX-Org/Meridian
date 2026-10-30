/**
 * Step 9 clients: fix simulation, wave readiness certificates, impact in money, outbound webhooks and automation
 * settings, config drift alerts, contract enforcement and the per-table change log of an extraction. Every read goes
 * through v2Get and every write through v2Send, so fixture mode answers them from lib/api/v2/fixtures/step9.ts.
 *
 * Endpoints (api/routes/simulate.py, wave_certificates.py, impact_money.py, webhooks.py, drift_alerts.py,
 * contracts.py, contract_breaches.py, extraction_changes.py):
 *   POST /simulate/fix, GET /simulate/fix/top
 *   GET, POST /migration/waves/{id}/certificate, POST .../{cert}/sign, GET .../{cert}/pdf
 *   GET /impact/money
 *   GET, POST /webhooks, PATCH, DELETE /webhooks/{id}, POST /webhooks/{id}/test, GET /webhooks/{id}/deliveries,
 *   GET /webhooks/events, GET, PUT /settings/automation
 *   GET /config/drift/alerts
 *   GET /objects/{module}/contracts, PUT /contracts/{id}/enforcement, GET /contracts/{id}/breaches
 *   GET /versions/{id}/changes
 * A field the backend does not return is not here; the screens show a dash for a null.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import type { DimensionKey, Verdict } from "./types";

// ── fix simulation ───────────────────────────────────────────────────────────

export interface SimulateBody {
  module: string;
  system_id?: string | null;
  run_id?: string | null;
  rules?: string[];
  records?: { module: string; record_key: string }[];
  batches?: string[];
}

export interface WaveGateState {
  wave_id: string;
  name: string;
  open: boolean;
  reasons: string[];
}

/** One side of the simulation: the receipt as it reads now (before) or with the chosen failures fixed (after). */
export interface SimState {
  score: number | null;
  raw_score: number | null;
  cap_level: number | null;
  breaches: string[];
  /** The measured dimensions only: a dimension the run did not measure is absent. */
  dimensions: Partial<Record<DimensionKey, number>>;
  verdict: Verdict | null;
  features_blocked: number;
  features_degraded: number;
  wave_gate: WaveGateState[];
}

export interface SimSentence {
  held_under_85: number;
  objects: number;
  critical_over_tolerance: number;
  release_if_fixed: string[];
  released: number;
}

export interface SimulateResult {
  module: string;
  run_id: string;
  run_at: string | null;
  system_id: string | null;
  before: SimState;
  after: SimState;
  delta: {
    score: number | null;
    raw_score: number | null;
    breaches_cleared: string[];
    features_blocked: number;
    features_degraded: number;
    verdict_changed: boolean;
    gates_opened: string[];
  };
  method: {
    basis?: string;
    reproduced?: boolean;
    stored_score?: number | null;
    rules_fixed?: string[];
    rules_unknown?: string[];
    records_resolved?: Record<string, number>;
    config_impact?: string;
    cached?: boolean;
  };
  landscape: { before: SimSentence; after: SimSentence } | null;
}

export interface TopFix {
  check_id: string;
  severity: string;
  failing: number;
  after_score: number | null;
  delta: number | null;
  after_verdict: Verdict | null;
  breach_cleared: boolean;
}

export interface TopFixes {
  module: string;
  run_id: string;
  score: number | null;
  rules: TopFix[];
}

export const simulateFix = (body: SimulateBody): Promise<SimulateResult> => v2Send("POST", "/simulate/fix", body);
export const getTopFixes = (module: string, systemId?: string | null, runId?: string | null): Promise<TopFixes> =>
  v2Get("/simulate/fix/top", { module, system_id: systemId ?? undefined, run_id: runId ?? undefined });

// ── wave readiness certificates ──────────────────────────────────────────────

export interface CertSigner {
  user_id: string;
  name: string;
  modules: string[];
}

export interface CertSignature {
  user_id: string;
  user: string | null;
  statement: string | null;
  signed_at: string;
}

export interface CertVersion {
  id: string;
  version: number;
  status: "issued" | "signed";
  sha256: string;
  report_file_id: string | null;
  issued_by: string | null;
  issued_at: string;
  measured_on: { module: string; run_id: string | null; run_at: string | null }[];
  signatures: CertSignature[];
}

export interface CertificateList {
  wave_id: string;
  required_signers: CertSigner[];
  versions: CertVersion[];
}

export interface IssuedCertificate {
  id: string;
  wave_id: string;
  version: number;
  status: "issued";
  sha256: string;
  report_file_id: string | null;
  measured_on: CertVersion["measured_on"];
  required_signers: CertSigner[];
}

export interface SignResult {
  id: string;
  version: number;
  status: "issued" | "signed";
  signed_by: string[];
  waiting_for: string[];
}

/** The 409 of an issue the gate refused: which objects stop it, and why. */
export interface GateRefusal {
  detail: string;
  objects: { module: string; reason: string; rules?: string[] }[];
}

const wavePath = (waveId: string) => `/migration/waves/${encodeURIComponent(waveId)}/certificate`;
export const getCertificates = (waveId: string): Promise<CertificateList> => v2Get(wavePath(waveId));
export const issueCertificate = (waveId: string): Promise<IssuedCertificate> => v2Send("POST", wavePath(waveId));
export const signCertificate = (waveId: string, certId: string, statement: string | null): Promise<SignResult> =>
  v2Send("POST", `${wavePath(waveId)}/${encodeURIComponent(certId)}/sign`, { statement: statement && statement.trim() ? statement.trim() : null });
export const downloadCertificate = (waveId: string, certId: string, version: number): Promise<string> =>
  v2Download(`${wavePath(waveId)}/${encodeURIComponent(certId)}/pdf`, undefined, `readiness_certificate_v${version}.pdf`);

/** The gate's refusal inside a failed issue (409), or null for any other failure. */
export function gateRefusalOf(error: unknown): GateRefusal | null {
  const res = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  const detail = res?.data?.detail;
  if (res?.status !== 409 || !detail || typeof detail !== "object") return null;
  const d = detail as { detail?: unknown; objects?: unknown };
  if (typeof d.detail !== "string" || !Array.isArray(d.objects)) return null;
  return { detail: d.detail, objects: d.objects as GateRefusal["objects"] };
}

// ── impact in money ──────────────────────────────────────────────────────────

export interface MoneyFeature {
  feature: string;
  system_id: string | null;
  system: string | null;
  run_id: string;
  status: "blocked" | "degraded";
  blocking_rules: string[];
  modules: string[];
  records: number;
  value_per_record_month: number | null;
  opportunity_cost_per_month: number | null;
  first_blocked_at: string | null;
  months_blocked: number;
  cumulative_cost: number | null;
}

export interface MoneyRank {
  id: string;
  name: string;
  value_unblocked_per_month: number | null;
  features: string[];
}

export interface Money {
  scope: "wave" | "object" | "landscape";
  id: string | null;
  as_of: string;
  currency: string | null;
  cost_model: boolean;
  features: MoneyFeature[];
  totals: { opportunity_cost_per_month: number | null; cumulative_cost: number | null; features_blocked: number; features_degraded: number };
  ranking: { waves: MoneyRank[]; objects: MoneyRank[] };
}

export const getMoney = (scope: Money["scope"], id?: string | null): Promise<Money> => v2Get("/impact/money", { scope, id: id ?? undefined });

// ── webhooks and automation settings ─────────────────────────────────────────

export type WebhookEvent = "*" | "run.finished" | "run.failed" | "batch.waiting" | "batch.approved" | "batch.sent" | "score.dropped" | "breach.new" | "config.drift" | "certificate.signed";

export interface Webhook {
  id: string;
  /** The host only: the API never returns the full URL, which often carries a token. */
  url: string;
  events: WebhookEvent[];
  active: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface WebhookCreated extends Webhook {
  /** Shown once, on creation. */
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  event_id: string | null;
  status: "pending" | "retrying" | "delivered" | "failed";
  attempts: number;
  response_code: number | null;
  error: string | null;
  created_at: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
}

export interface WebhookTest {
  delivery_id: string;
  status: WebhookDelivery["status"];
  response_code?: number | null;
  attempts?: number;
  error?: string | null;
}

export interface AutomationSettings {
  drift_alerts: { enabled: boolean };
  rule_mining: { min_records: number };
  score_drop: { below: number | null; points: number | null };
}

export const listWebhooks = (): Promise<{ webhooks: Webhook[] }> => v2Get("/webhooks");
export const listWebhookEvents = (): Promise<{ events: WebhookEvent[] }> => v2Get("/webhooks/events");
export const createWebhook = (body: { url: string; events: WebhookEvent[]; description?: string | null; active?: boolean; secret?: string }): Promise<WebhookCreated> => v2Send("POST", "/webhooks", body);
export const updateWebhook = (id: string, body: Partial<{ url: string; events: WebhookEvent[]; description: string | null; active: boolean; secret: string }>): Promise<Webhook> =>
  v2Send("PATCH", `/webhooks/${encodeURIComponent(id)}`, body);
export const deleteWebhook = (id: string): Promise<void> => v2Send("DELETE", `/webhooks/${encodeURIComponent(id)}`);
export const testWebhook = (id: string): Promise<WebhookTest> => v2Send("POST", `/webhooks/${encodeURIComponent(id)}/test`);
export const listDeliveries = (id: string, status?: WebhookDelivery["status"]): Promise<{ deliveries: WebhookDelivery[] }> =>
  v2Get(`/webhooks/${encodeURIComponent(id)}/deliveries`, { status, limit: 100 });
export const getAutomation = (): Promise<AutomationSettings> => v2Get("/settings/automation");
export const putAutomation = (body: Partial<AutomationSettings>): Promise<AutomationSettings> => v2Send("PUT", "/settings/automation", body);

// ── config drift alerts ──────────────────────────────────────────────────────

export interface DriftArea {
  area: string;
  added: number;
  removed: number;
  changed: number;
}

export interface DriftAlert {
  id: string;
  system_id: string | null;
  system_name: string | null;
  /** config_sync or config_load */
  source: string;
  run_id: string | null;
  areas: DriftArea[];
  rules: { check_id: string; name: string | null }[];
  objects: string[];
  /** The run that is re-scored. */
  version_id: string | null;
  notified: number;
  rescore_queued: boolean;
  created_at: string;
}

export const getDriftAlerts = (limit = 50): Promise<{ alerts: DriftAlert[] }> => v2Get("/config/drift/alerts", { limit });

// ── contract enforcement ─────────────────────────────────────────────────────

export interface ContractThresholds {
  min_score?: number;
  max_critical_breaches?: number;
  dimensions?: Partial<Record<DimensionKey, number>>;
}

export interface ContractBreach {
  metric: string;
  threshold: number;
  actual: number | null;
}

export interface ObjectContract {
  contract_id: string;
  name: string;
  producer: string;
  consumer: string;
  enforce: boolean;
  thresholds: ContractThresholds;
  breaches: ContractBreach[];
}

export interface ObjectContracts {
  module: string;
  run_id: string | null;
  contracts: ObjectContract[];
  breached: number;
  enforced_breached: number;
}

export const getObjectContracts = (module: string, run?: string | null): Promise<ObjectContracts> =>
  v2Get(`/objects/${encodeURIComponent(module)}/contracts`, { run: run ?? undefined });
export const setEnforcement = (id: string, body: { enforce: boolean; thresholds: ContractThresholds | null }): Promise<{ id: string; enforce: boolean; thresholds: ContractThresholds | null }> =>
  v2Send("PUT", `/contracts/${encodeURIComponent(id)}/enforcement`, body);
/** A new draft contract for one object: created, then its thresholds and enforcement set (two audited writes). */
export async function createObjectContract(body: { name: string; module: string; consumer: string; enforce: boolean; thresholds: ContractThresholds }): Promise<{ id: string }> {
  const made = await v2Send<{ id: string; status: string }>("POST", "/contracts", { name: body.name, producer: body.module, consumer: body.consumer, quality_contract: { module: body.module } });
  await setEnforcement(made.id, { enforce: body.enforce, thresholds: body.thresholds });
  return { id: made.id };
}

/** The 409 of a refused baseline pin: the sentence and the breaches of the enforced contracts. */
export interface BaselineRefusal {
  detail: string;
  breaches: (ContractBreach & { contract_id?: string; name?: string | null; enforce?: boolean; module?: string })[];
}

export function baselineRefusalOf(error: unknown): BaselineRefusal | null {
  const res = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  const detail = res?.data?.detail;
  if (res?.status !== 409 || !detail || typeof detail !== "object") return null;
  const d = detail as { detail?: unknown; breaches?: unknown };
  if (typeof d.detail !== "string" || !Array.isArray(d.breaches)) return null;
  return { detail: d.detail, breaches: d.breaches as BaselineRefusal["breaches"] };
}

// ── per-table change log of an extraction ────────────────────────────────────

export interface TableChange {
  table: string;
  /** change_date (re-read by change date and merged), full (read in full and compared) */
  mode: string;
  rows_read: number;
  rows_total: number | null;
  /** Null when the table was not compared with an earlier extraction. */
  inserted: number | null;
  updated: number | null;
  deleted: number | null;
  unchanged: number | null;
  duration_s: number | null;
}

export interface VersionChanges {
  version_id: string;
  /** metadata.delta of the version: null for a full download. */
  delta: { baseline_version_id?: string | null; since?: string | null } | null;
  tables: TableChange[];
  totals: { rows_read: number; rows_total: number; inserted: number | null; updated: number | null; deleted: number | null; unchanged: number | null; changed: number | null };
}

export const getVersionChanges = (versionId: string): Promise<VersionChanges> => v2Get(`/versions/${encodeURIComponent(versionId)}/changes`);
