import { t } from "@/lib/v2/i18n";
/**
 * Step 0 API contract (API-CONTRACT-step0.md): GET /landscape, /objects/{module}/receipt, /status, /command.
 * A value the backend has not stored is null and the UI shows a dash; nothing here is ever filled in client side.
 */

export type DimensionKey = "completeness" | "accuracy" | "consistency" | "timeliness" | "uniqueness" | "validity";

/** The six dimensions in ruler order, with the DAMA weights the score formula uses. */
/** The six DAMA dimensions. `label` is read through the v2 catalogue, so it is in the interface's language. */
export const DIMENSIONS: ReadonlyArray<{ key: DimensionKey; label: string; weight: number }> = [
  { key: "completeness", get label() { return t("Completeness"); }, weight: 0.25 },
  { key: "accuracy", get label() { return t("Accuracy"); }, weight: 0.25 },
  { key: "consistency", get label() { return t("Consistency"); }, weight: 0.2 },
  { key: "timeliness", get label() { return t("Timeliness"); }, weight: 0.1 },
  { key: "uniqueness", get label() { return t("Uniqueness"); }, weight: 0.1 },
  { key: "validity", get label() { return t("Validity"); }, weight: 0.1 },
];

export type Verdict = "no-go" | "at-risk" | "go";
export type SystemState = "analysed" | "extracted" | "not_extracted";

export interface StatusStrip {
  run_at: string | null;
  records_checked: number | null;
  rules_measured: number | null;
  scored_in_s: number | null;
  cost_model: string | null;
  /**
   * Where the cost model's figures come from: "default" while the tenant has not changed the shipped starting
   * assumptions (checks/cost_model.yaml), "tenant" once it has. Absent on a server from before it: treated as set.
   */
  cost_model_source?: "default" | "tenant" | null;
  licence_valid_to: string | null;
  /** Step 10: the tenant is in sandbox mode, so nothing leaves the deployment. Absent on a server from before it. */
  sandbox?: boolean;
}

export interface LandscapeSystem {
  id: string;
  name: string;
  system_type: string;
  version: string | null;
  client: string | null;
  health_status: string | null;
  last_extracted_at: string | null;
  records: number | null;
  state: SystemState;
  latest_run_id: string | null;
}

export interface LandscapeObject {
  /** Module id as the API uses it, with underscores (material_master). */
  module: string;
  label: string;
}

export interface LandscapeCell {
  system_id: string;
  module: string;
  run_id: string;
  /** The shown score: capped when a cap applies. */
  score: number | null;
  /** The measured score before the cap. */
  raw_score: number | null;
  capped: boolean;
  cap_level: number | null;
  /** Check ids of the critical rules over tolerance. */
  breaches: string[];
  verdict: Verdict;
  /** 0 to 1 */
  coverage: number | null;
  low_confidence: boolean;
  records_checked: number | null;
  rules_measured: number | null;
  open_work: number | null;
  dimensions: Record<DimensionKey, number | null>;
  /** Step 9: thresholds of active data contracts this cell breaches, and how many of them are enforced. */
  contract_breaches?: number;
  enforced_contract_breaches?: number;
  /** Step 10: applied policy-pack classes with a failing critical rule in this cell. */
  policy_breaches?: number;
}

export interface LandscapeSentence {
  held_under_85: number;
  objects: number;
  critical_over_tolerance: number;
  release_if_fixed: string[];
  released: number;
}

export interface Landscape {
  scope: "current" | "run";
  run_id: string | null;
  status_strip: StatusStrip;
  systems: LandscapeSystem[];
  objects: LandscapeObject[];
  cells: LandscapeCell[];
  sentence: LandscapeSentence;
  counts: { go: number; at_risk: number; no_go: number };
}

export interface ReceiptDimension {
  key: DimensionKey;
  label: string;
  weight: number;
  score: number | null;
  points: number | null;
  rules_measured: number | null;
  records_checked: number | null;
  coverage: number | null;
}

export interface ReceiptBreach {
  check_id: string;
  name: string;
  failing: number | null;
  pct: number | null;
  tolerance_rows: number | null;
  tolerance_pct: number | null;
}

export interface Receipt {
  module: string;
  label: string;
  run_id: string;
  run_at: string | null;
  records_checked: number | null;
  rules_measured: number | null;
  coverage: number | null;
  low_confidence: boolean;
  weights: Record<DimensionKey, number>;
  dimensions: ReceiptDimension[];
  /** Null when the stored summary cannot reproduce the weighted sum: the row is then left out, never fudged. */
  weighted: number | null;
  measured: number | null;
  cap_level: number | null;
  capped: boolean;
  score: number | null;
  breaches: ReceiptBreach[];
  tolerance: { pct: number; rows: number };
  formula: string;
  severity_weights: Record<"critical" | "high" | "medium" | "low", number>;
  cap_rule: string;
  value_at_risk: number | null;
  currency: string | null;
  /** As on the status strip: "default" while value at risk is priced from the shipped starting assumptions. */
  cost_model_source?: "default" | "tenant" | null;
  features_blocked: number | null;
  features_degraded: number | null;
  open_work: number | null;
  /** Step 9: the thresholds of active data contracts the object breaches on this run. */
  contract_breaches?: { contract_id: string; name: string | null; enforce: boolean; metric: string; threshold: number; actual: number | null }[];
  /** Step 10: applied policy-pack classes with a failing critical rule of the object in this run. */
  policy_breaches?: number;
  policy_breach_classes?: { pack_id: string; class_id: string; label: string; authority: string; rules: string[] }[];
}

export type CommandKind = "record" | "rule" | "object" | "run" | "person" | "action";

export interface CommandItem {
  id: string;
  title: string;
  href: string;
}

export interface CommandGroup {
  kind: CommandKind;
  label: string;
  items: CommandItem[];
}

export interface CommandResult {
  groups: CommandGroup[];
}

/** A run as the run menu needs it: the fields of GET /versions this interface reads. */
export interface RunSummary {
  id: string;
  run_at: string;
  label: string | null;
  run_number?: number | null;
  status: string;
}

export interface RunList {
  versions: RunSummary[];
  total?: number;
}

export type WorkStatus = "to_fix" | "proposed" | "approved" | "sent" | "not_an_issue" | "fixed";

/** One row of GET /work/records. `value_at_risk` is the step 0 addition; absent on a server from before it. */
export interface WorkRow {
  module: string;
  version_id?: string;
  record_key: string;
  name: string | null;
  issues: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  checks: string[];
  proposed: number;
  status: WorkStatus;
  top_message: string | null;
  top_field: string | null;
  suggested_value?: string | null;
  value_at_risk?: number | null;
  due_at?: string | null;
  assigned_to?: string | null;
  assignee_email?: string | null;
  first_seen_at?: string | null;
  /**
   * Not in GET /work/records yet (the ledger asks the backend for them; a row without them shows a dash):
   * the field's current value, the rule's possible values (value and meaning), how many more there are, the field's
   * business description and, for an exception, whether the sign-off was "not an issue" or "accept risk".
   */
  current_value?: string | null;
  possible_values?: { value: string; label: string | null }[] | null;
  possible_values_total?: number | null;
  field_description?: string | null;
  /** The value waiting in the user's draft fix batch for this record (status proposed). */
  new_value?: string | null;
  resolution?: "false_positive" | "accepted_risk" | null;
  /**
   * Not in GET /work/records yet (a dash is shown without them): the draft batch the value waits in (or the approved or
   * sent batch it went with), and for an exception the reason given, who signed it off and when.
   */
  batch_id?: string | null;
  batch_name?: string | null;
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface WorkPage {
  version_id: string | null;
  total: number;
  total_capped: boolean;
  next: string | null;
  items: WorkRow[];
}

/** One rule of the Rules tab (GET /findings, reduced to what the tab shows). */
export interface RuleRow {
  check_id: string;
  name: string;
  field: string | null;
  severity: "critical" | "high" | "medium" | "low" | "info";
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
  value_at_risk: number | null;
  /** The rule's dimension; the Rules tab pivots on it. */
  dimension?: DimensionKey | null;
  /** The check class (domain_value_check, null_check ...). */
  check_class?: string | null;
  /** rule_context.why_it_matters: the one line under the rule name. */
  why?: string | null;
  /** The field in business words (the glossary term), beside the SAP field. */
  field_description?: string | null;
}
