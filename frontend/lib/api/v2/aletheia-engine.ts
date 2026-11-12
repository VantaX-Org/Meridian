/**
 * Meridian's own Aletheia engine sidecar (api/routes/aletheia_engine.py).
 *
 *   GET /aletheia/engine            whether the engine is configured and reachable, its version, licence verdict and usage
 *   GET /insights/engine-drivers    normal ranges and lead/lag links the engine learned from the run trend
 *   GET /aletheia/foresight         composite projection with a 95% band and go-live date, plus engine surprises
 *   GET /aletheia/reason            anomalies and causal risks over the run history, plus the engine's reasoning layer
 *
 * Both answer when the engine is off; the body says why. Only run-level scores and counts reach the engine.
 */
import { v2Get } from "./client";

export interface EngineLicence {
  valid: boolean;
  /** False when no licence key is set: the engine then runs unlicensed. */
  licensed: boolean;
  reason: string | null;
  deployment: string | null;
  expires: string | null;
  max_tenants: number | null;
}

export interface EngineStatus {
  configured: boolean;
  live: boolean;
  token_set: boolean;
  tenant: string;
  version: string | null;
  licence: EngineLicence | null;
  usage: { counters?: Record<string, number>; events?: number; first_seen?: string | number | null; last_seen?: string | number | null } | null;
}

export type EngineOffReason = "too_few_runs" | "not_configured" | "unreachable" | "no_token" | "licence_invalid" | "engine_error";

export interface EngineRange { metric: string; mean: number | null; low: number | null; high: number | null; n: number | null; latest: number | null; outside: boolean }
export interface EngineLink { source: string; target: string; lag: number | null; correlation: number | null }

export interface EngineDrivers {
  labels: Record<string, string>;
  available: boolean;
  reason?: EngineOffReason;
  runs?: number;
  ranges?: EngineRange[];
  links?: EngineLink[];
}

export const getEngineStatus = () => v2Get<EngineStatus>("/aletheia/engine");
export const getEngineDrivers = () => v2Get<EngineDrivers>("/insights/engine-drivers", { limit: 12 });

/** What a result was computed from, how, and how sure it is (0 to 100; null when the method has no single figure). */
export interface Evidence { inputs: string[]; method: string; confidence: number | null; runs?: number | null; first_run?: string | null; last_run?: string | null }
export interface BandPoint { date: string | null; point: number; low: number; high: number }
export type GoLiveStatus = "reached" | "projected" | "not_converging" | "beyond_horizon";
export interface Projection {
  available: boolean;
  reason?: "too_few_runs" | "undated" | null;
  latest?: number | null;
  slope_per_30d?: number | null;
  next?: BandPoint | null;
  go_live?: { status: GoLiveStatus; projected: string | null; earliest: string | null; latest: string | null } | null;
  band?: BandPoint[] | null;
  evidence: Evidence;
}
export interface Surprise { metric: string; version_id: string | null; label: string | null; run_at: string | null; expected: number | null; observed: number | null; z: number | null; severity: "high" | "medium" }
export interface Foresight {
  lineage: string;
  labels: Record<string, string>;
  target: number;
  target_source: "query" | "tenant";
  runs: { version_id: string | null; label: string | null; run_at: string | null; composite: number | null }[];
  projection: Projection;
  engine: {
    available: boolean;
    reason?: EngineOffReason | null;
    normal: { mean: number | null; low: number | null; high: number | null; n: number | null; latest: number | null; outside: boolean | null } | null;
    surprises: Surprise[];
    methodology: string[];
    evidence: Evidence;
  };
}

export const getForesight = () => v2Get<Foresight>("/aletheia/foresight", { limit: 12 });

export interface Anomaly { metric: string; version_id: string | null; label: string | null; run_at: string | null; expected: number | null; observed: number | null; z: number | null; severity: "high" | "medium" }
/** A rule or dimension whose recent change explains part of the composite's movement; effect is in composite points. */
export interface CausalRisk { kind: "rule" | "dimension"; driver: string; name: string; change: number | null; effect: number | null; confidence: number }
export interface Reason {
  lineage: string;
  labels: Record<string, string>;
  runs: { version_id: string | null; label: string | null; run_at: string | null; composite: number | null }[];
  deterministic: { available: boolean; reason?: "too_few_runs" | null; anomalies: Anomaly[]; risks: CausalRisk[]; anomaly_evidence: Evidence; risk_evidence: Evidence };
  /** The engine's own layer. Its request and response contract is not published, so anomalies and risks stay empty until it is. */
  engine: { available: boolean; reason?: EngineOffReason | null; anomalies: Anomaly[]; risks: CausalRisk[]; evidence: Evidence };
}

export const getReason = () => v2Get<Reason>("/aletheia/reason", { limit: 12 });

/** Pattern counts over a rule's listed failing values (shape masks such as "AA9", never a value itself). */
export interface CleaningPattern { listed: number; blank: number; masks: { mask: string; count: number }[]; leading_ws: number; trailing_ws: number; inner_ws: number; case: Record<string, number> }
export type CleaningKind = "auto" | "fill" | "pick" | "review";
/** A fix value Meridian computed locally; confidence is 0 to 100 and covered of base is what it rests on. */
export interface CleaningSuggestion { value: string; source: string; covered: number; base: number; confidence: number; evidence: string }
export interface CleaningItem {
  rule: string; message: string; field: string; field_label: string; severity: string; dimension: string; check_class?: string | null;
  affected: number; total: number; pass_rate?: number | null; kind: string; explanation: string;
  pattern?: CleaningPattern | null; suggestion?: CleaningSuggestion | null;
}
export interface CleaningBatch { id: string; kind: string; field: string; field_label: string; rules: string[]; affected: number; suggested: number; instruction: string; evidence: string }
export interface RuleChange { rule: string; before: number; after: number }
export interface CleaningChanges { available: boolean; previous?: Record<string, unknown> | null; new: RuleChange[]; resolved: RuleChange[]; worse: RuleChange[]; better: RuleChange[]; narrative: string }
export interface RuleRange { rule: string; mean: number | null; low: number | null; high: number | null; n: number | null; latest: number; outside: boolean }
export interface CleaningPlan {
  version_id: string; run_label?: string | null; module: string;
  items: CleaningItem[]; batches: CleaningBatch[]; changes: CleaningChanges;
  engine: { available: boolean; reason?: string | null; runs: number; ranges: RuleRange[]; evidence: Evidence };
}

/** GET /aletheia/cleaning-plan: why each rule fails, the suggested fix, fix batches and what changed since the last run. */
export const getCleaningPlan = (module: string, versionId?: string | null) =>
  v2Get<CleaningPlan>("/aletheia/cleaning-plan", versionId ? { module, version_id: versionId } : { module });
