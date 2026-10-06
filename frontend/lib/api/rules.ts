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

export async function createCustomRule(body: CustomRuleDraft): Promise<{ id: string; name: string }> {
  const { data } = await apiClient.post("/api/v1/rules/custom", body);
  return data;
}

/** Evaluate a draft against a version's stored extract. Writes nothing. */
export async function dryRunRule(body: CustomRuleDraft): Promise<DryRunResult> {
  const { data } = await apiClient.post<DryRunResult>("/api/v1/rules/dry-run", body);
  return data;
}

export interface RuleDetail {
  id: string;
  module: string;
  category: string | null;
  field: string | null;
  check_class: string | null;
  severity: string | null;
  dimension: string | null;
  message: string | null;
  why_it_matters: string | null;
  rule_authority: string | null;
  sap_impact: string | null;
  fix_map: Record<string, string> | null;
  record_fix_template: string | null;
  grain: unknown;
  id_field: string | null;
  scope_field: string | null;
  max_depth: number | null;
  applies_when: unknown;
  fail_when: unknown;
  target_table: string | null;
  target_fields: unknown;
  reference_table: string | null;
  reference_field: string | null;
  pattern: string | null;
  allowed_values: unknown;
  valid_values_with_labels: Record<string, string> | null;
  group_by: unknown;
  max_age_hours: number | null;
  baseline: unknown;
  simplification_item: string | null;
  transaction: string | null;
  extra: Record<string, unknown>;
  rule_uuid: string | null;
  enabled: boolean;
  source: string | null;
  latest_finding_id: string | null;
  latest_version_id: string | null;
}

/** The full rule for a SAP-facing code, whether or not it has ever run. */
export async function getRuleByCode(checkId: string, module?: string): Promise<RuleDetail> {
  const { data } = await apiClient.get<RuleDetail>(`/api/v1/rules/by-code/${encodeURIComponent(checkId)}`, { params: { module } });
  return data;
}

export interface CoverageObject {
  module: string;
  by_dimension: Record<string, number>;
  total: number;
  never_run: number;
}

export interface CoverageMatrix {
  objects: CoverageObject[];
  dimensions: string[];
  check_classes: { check_class: string | null; count: number }[];
  totals: { shipped: number; rules: number; enabled: number; customer: number; objects: number; thin_cells: number; never_run: number };
}

export async function getRuleCoverage(params?: { system?: string; authority?: string; check_class?: string; enabled?: boolean }): Promise<CoverageMatrix> {
  const { data } = await apiClient.get<CoverageMatrix>("/api/v1/rules/coverage", { params });
  return data;
}

export interface ViewRule {
  check_id: string;
  message: string | null;
  check_class: string | null;
  severity: string | null;
  dimension: string | null;
  field: string | null;
  last_pass_rate: number | null;
}

export interface ModuleCoverage {
  module: string;
  has_view_map: boolean;
  object: CoverageObject;
  views: { view: string; label: string; total: number; tables: { table: string; count: number }[]; rules: ViewRule[] }[];
  dimension_by_view: Record<string, Record<string, number>>;
  totals: { rules: number; never_run: number; views: number; views_total: number; tables: number };
}

export async function getModuleCoverage(module: string, params?: { enabled?: boolean }): Promise<ModuleCoverage> {
  const { data } = await apiClient.get<ModuleCoverage>(`/api/v1/rules/coverage/${encodeURIComponent(module)}`, { params });
  return data;
}

export interface DdicField {
  table: string;
  field: string;
  description: string | null;
  data_element: string | null;
  domain: string | null;
  type: string | null;
  length: number | null;
  check_table: string | null;
  check_field: string | null;
  check_table_description: string | null;
  missing: boolean;
}

/** Standard ECC dictionary entries for TABLE.FIELD names (at most 100). */
export async function getDdicFields(fields: string[]): Promise<DdicField[]> {
  const { data } = await apiClient.get<{ fields: DdicField[] }>("/api/v1/ddic/fields", { params: { fields: fields.join(",") } });
  return data.fields;
}

export interface RuleVersion {
  rule_id: string;
  version: number;
  body: Record<string, unknown>;
  state: string;
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Change history of one rule, by its row id. */
export async function getRuleVersions(ruleUuid: string): Promise<{ rule_id: string; shipped: boolean; versions: RuleVersion[] }> {
  const { data } = await apiClient.get(`/api/v1/rules/${ruleUuid}/versions`);
  return data;
}
