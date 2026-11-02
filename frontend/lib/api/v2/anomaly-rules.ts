/**
 * Aletheia anomaly-to-rule client: a detected outlier in, a proposed deterministic rule out, with its dry-run hit count.
 *
 * Endpoint (api/routes/aletheia_anomaly_rules.py, needs manage_rules):
 *   POST /aletheia/anomaly-rules/propose   { anomaly_id } -> proposed YAML, dry run on the latest extraction, grounding
 * Approving saves a draft through the existing rule-authoring path (POST /rule-authoring/drafts). The AI drafts only
 * when no template fits, and sees the field, the statistic and counts, never a record.
 */
import type { SavedDraft } from "@/lib/api/rule-authoring";
import { v2Get, v2Send } from "./client";

export interface AnomalyDryRun {
  evaluated: boolean;
  hits?: number;
  population?: number;
  pass_rate?: number;
  reason?: string;
}

export interface AnomalyGrounding {
  kind: "outlier" | "null_spike" | "unexpected_code";
  module: string;
  field: string;
  field_description: string | null;
  statistic: { method: string | null; z_score: number | null; lower: number | null; upper: number | null };
  anomaly_count: number | null;
  rule_hits: number | null;
  population: number | null;
  /** What the AI was sent when it drafted: empty for a template. */
  ai_sent: string[];
}

export interface AnomalyRuleProposal {
  rule_yaml: string | null;
  valid: boolean;
  errors: string[];
  source: "template" | "llm";
  version_id: string | null;
  dry_run: AnomalyDryRun;
  grounding: AnomalyGrounding;
  confidence: { basis: "template" | "llm"; level: "high" | "medium" | "low" } | null;
}

export const proposeAnomalyRule = (anomalyId: string): Promise<AnomalyRuleProposal> =>
  v2Send("POST", "/aletheia/anomaly-rules/propose", { anomaly_id: anomalyId });

export interface ShiftCounts {
  rows: number | null;
  blank: number | null;
  blank_pct: number | null;
  distinct: number | null;
}

/** A null spike or an unexpected code found by comparing a run's field profile with the run before (aggregates only). */
export interface FieldShift {
  id: string;
  version_id: string;
  prev_version_id: string | null;
  run_number: number | null;
  prev_run_number: number | null;
  module: string;
  /** TABLE.FIELD */
  field: string;
  field_description: string | null;
  kind: "null_spike" | "unexpected_code";
  severity: "critical" | "high" | "medium" | "low";
  current: ShiftCounts;
  previous: ShiftCounts;
  codes: { value: string; count: number }[];
  detected_at: string;
}

/** GET /aletheia/anomaly-rules/shifts: each object's latest run that has any. */
export const getFieldShifts = (): Promise<FieldShift[]> => v2Get("/aletheia/anomaly-rules/shifts");

export interface ShiftDraft {
  id: string;
  status: "draft";
  /** False when the same rule was already a draft. */
  created: boolean;
  rule: Record<string, unknown>;
  rule_yaml: string;
}

/** POST /aletheia/anomaly-rules/shifts/propose (needs manage_rules): a pending draft built from the shift's profile aggregates. */
export const proposeShiftRule = (s: Pick<FieldShift, "field" | "kind" | "version_id">): Promise<ShiftDraft> => {
  const [table, ...rest] = s.field.split(".");
  return v2Send("POST", "/aletheia/anomaly-rules/shifts/propose", { table, field: rest.join("."), kind: s.kind, version_id: s.version_id });
};

/** Approve: the proposed YAML becomes a draft, as in the rule workbench. */
export const approveAnomalyRule = (module: string, ruleYaml: string, rationale: string): Promise<SavedDraft> =>
  v2Send("POST", "/rule-authoring/drafts", { module, rule_yaml: ruleYaml, rationale });
