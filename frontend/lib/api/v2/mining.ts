/**
 * Data mining client: the likely duplicates, outliers and field relationships the mining tasks found in the data.
 *
 * Endpoints (api/routes/mining.py, all need mdm.read except the run):
 *   GET  /mining/summary?window_days=          (patterns found in the window, runs mined, share of analysed objects mined)
 *   GET  /mining/duplicates?scope=current      (record pairs by match score, highest first)
 *   GET  /mining/anomalies?scope=current       (values outside the usual range of their field)
 *   GET  /mining/relationships?scope=current   (fields whose values move together)
 *   GET  /mining/patterns                      (the outliers grouped by field and the duplicates by object)
 *   POST /mining/run                           (mine one analysis run again; needs mdm.write)
 *   GET  /mining/summary/{version_id}          (duplicate, outlier and relationship counts per object of one run)
 *   GET  /process/mining/graph/{version_id}/{module}  (process_mining.py: the module's activities, flows and
 *                                              variants with the quality of each step; needs view and a licence)
 * scope=current keeps each object at the latest complete run of its lineage, so the lists are the current state.
 */
import { v2Get, v2Send } from "./client";

export type Severity = "low" | "medium" | "high" | "critical";

export interface MiningOverview {
  window_days: number;
  total_patterns: number;
  new_anomalies: number;
  stable_patterns: number;
  coverage_pct: number;
  runs_total: number;
  cost_usd: number;
}

export interface DuplicatePair {
  id: string;
  version_id: string;
  module_id: string;
  record_a: string;
  record_b: string;
  match_score: number;
  id_field?: string | null;
  matched_fields?: string[] | null;
  /** The dictionary text of each matched field the dictionary knows, keyed by field name. */
  field_texts?: Record<string, string>;
  detected_at: string;
}

export interface AnomalyItem {
  id: string;
  version_id: string;
  module_id: string;
  field_name: string;
  /** The field's dictionary text; null when the dictionary does not know it. */
  field_description?: string | null;
  field_value?: number | null;
  record_index?: number | null;
  record_key?: string | null;
  detection_method: string;
  z_score?: number | null;
  lower_bound?: number | null;
  upper_bound?: number | null;
  severity: Severity;
  detected_at: string;
}

export interface RelationshipItem {
  id: string;
  version_id: string;
  module_id: string;
  field_a: string;
  field_b: string;
  field_a_description?: string | null;
  field_b_description?: string | null;
  relationship_type: string;
  strength_score: number;
  detected_at: string;
}

export interface MiningPattern {
  id: string;
  name: string;
  module: string;
  pattern_type: "anomaly" | "duplicate";
  severity: Severity;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  confidence: number | null;
  /** The mined field's dictionary text, anomaly patterns only. */
  field_description?: string | null;
  trend: unknown[];
  promoted_to_rule: boolean;
}

/** The most rows each list asks for; a list that comes back this long says "or more". */
export const LIMITS = { duplicates: 1000, anomalies: 2000, relationships: 500 } as const;

export const getMiningOverview = () => v2Get<MiningOverview>("/mining/summary", { window_days: 30 });
export const getDuplicates = () => v2Get<DuplicatePair[]>("/mining/duplicates", { scope: "current", limit: LIMITS.duplicates });
export const getAnomalies = () => v2Get<AnomalyItem[]>("/mining/anomalies", { scope: "current", limit: LIMITS.anomalies });
export const getRelationships = () => v2Get<RelationshipItem[]>("/mining/relationships", { scope: "current", limit: LIMITS.relationships });
export const getPatterns = () => v2Get<{ patterns: MiningPattern[] }>("/mining/patterns", { limit: 500 });
export const runMining = (version_id: string, modules: string[]) =>
  v2Send<{ task_id: string; version_id: string; include: string[] }>("POST", "/mining/run", { version_id, modules });

export interface MiningRunSummary {
  version_id: string;
  per_module: Record<string, { duplicates: number; anomalies: number; relationships: number }>;
  totals: { duplicates: number; anomalies: number; relationships: number };
}

export type StepStatus = "green" | "amber" | "red";

export interface MiningActivity {
  id: string;
  label: string;
  l4_id: string;
  l4_name: string;
  tcode?: string | null;
  step_status: StepStatus;
  affected_records: number;
  finding_count: number;
  avg_pass_rate?: number | null;
}

export interface MiningTransition {
  from: string;
  to: string;
  weight: number;
}

export interface MiningVariant {
  id: string;
  label: string;
  tcode?: string | null;
  activity_count: number;
  coverage: number;
  readiness: StepStatus;
  quality: number;
  activity_ids: string[];
}

export interface MiningGraph {
  version_id: string;
  module: string;
  activities: MiningActivity[];
  transitions: MiningTransition[];
  variants: MiningVariant[];
  cases: Record<string, unknown>[];
  cases_supported: boolean;
}

const enc = encodeURIComponent;
export const getMiningRunSummary = (versionId: string) => v2Get<MiningRunSummary>(`/mining/summary/${enc(versionId)}`);
export const getMiningGraph = (versionId: string, module: string) =>
  v2Get<MiningGraph>(`/process/mining/graph/${enc(versionId)}/${enc(module)}`);
