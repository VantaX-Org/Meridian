import apiClient from "./client";

export interface Rule {
  id: string;
  name: string;
  description: string | null;
  module: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  enabled: boolean;
  /** Shipped rules: a list of field conditions. Mined/custom rules: one check-engine rule object. */
  conditions: Record<string, unknown>[] | Record<string, unknown> | null;
  thresholds: object | null;
  tags: string[] | null;
  source_yaml: string | null;
  source: "yaml" | "hq" | "mined" | "custom";
  created_at: string;
  updated_at: string;
  /** Pass rate of the rule's most recent finding; null when it has not run yet. */
  last_pass_rate?: number | null;
  last_run_at?: string | null;
}

export interface RulesListResponse {
  rules: Rule[];
  total: number;
  limit: number;
  offset: number;
}

export interface RulesSummaryItem {
  category: string;
  severity: string;
  enabled: boolean;
  /** "yaml" = shipped with Meridian; anything else was defined by the customer or HQ. */
  source: string;
  count: number;
}

export async function getRules(params?: {
  category?: string;
  module?: string;
  severity?: string;
  enabled?: boolean;
  search?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<RulesListResponse> {
  const { data } = await apiClient.get<RulesListResponse>("/api/v1/rules", {
    params,
  });
  return data;
}

export async function getRulesSummary(): Promise<{ summary: RulesSummaryItem[] }> {
  const { data } = await apiClient.get("/api/v1/rules/summary");
  return data;
}

export async function getRule(ruleId: string): Promise<Rule> {
  const { data } = await apiClient.get<Rule>(`/api/v1/rules/${ruleId}`);
  return data;
}

/**
 * Toggle the `enabled` flag on a rule for this tenant. The backend
 * only allows `enabled` to be mutated customer-side; any other field
 * change must happen via HQ sync.
 */
export async function updateRule(
  ruleId: string,
  body: { enabled: boolean },
): Promise<Rule> {
  const { data } = await apiClient.patch<Rule>(
    `/api/v1/rules/${ruleId}`,
    body,
  );
  return data;
}

export type CheckClass =
  | "null_check"
  | "domain_value_check"
  | "regex_check"
  | "cross_field_check"
  | "dependency_check"
  | "uniqueness_check";

/** A steward-authored rule. Fields are `TABLE.FIELD`; `version_id` picks the DDIC and the dry-run data. */
export interface CustomRuleDraft {
  module: string;
  check_class: CheckClass;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  dimension?: string;
  field?: string;
  allowed_values?: string[];
  pattern?: string;
  fail_when?: string;
  determinant?: string;
  fields?: string[];
  version_id?: string;
}

export interface DryRunResult {
  population: number;
  failing: number;
  pass_rate: number;
  grain: string | null;
  sample_keys: string[];
  error: string | null;
}

export interface RuleHistoryEvent {
  at: string;
  actor: string | null;
  action: string;
  changes: Record<string, unknown>;
}

export async function createCustomRule(body: CustomRuleDraft): Promise<{ id: string; name: string }> {
  const { data } = await apiClient.post("/api/v1/rules/custom", body);
  return data;
}

/** Evaluate a draft against a version's stored extract. Writes nothing. */
export async function dryRunRule(body: CustomRuleDraft): Promise<DryRunResult> {
  const { data } = await apiClient.post<DryRunResult>("/api/v1/rules/dry-run", body);
  return data;
}

export async function getRuleHistory(ruleId: string): Promise<{ events: RuleHistoryEvent[] }> {
  const { data } = await apiClient.get(`/api/v1/rules/${ruleId}/history`);
  return data;
}
