/**
 * Aletheia anomaly-to-rule client: a detected outlier in, a proposed deterministic rule out, with its dry-run hit count.
 *
 * Endpoint (api/routes/aletheia_anomaly_rules.py, needs manage_rules):
 *   POST /aletheia/anomaly-rules/propose   { anomaly_id } -> proposed YAML, dry run on the latest extraction, grounding
 * Approving saves a draft through the existing rule-authoring path (POST /rule-authoring/drafts). The AI drafts only
 * when no template fits, and sees the field, the statistic and counts, never a record.
 */
import type { SavedDraft } from "@/lib/api/rule-authoring";
import { v2Send } from "./client";

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

/** Approve: the proposed YAML becomes a draft, as in the rule workbench. */
export const approveAnomalyRule = (module: string, ruleYaml: string, rationale: string): Promise<SavedDraft> =>
  v2Send("POST", "/rule-authoring/drafts", { module, rule_yaml: ruleYaml, rationale });
