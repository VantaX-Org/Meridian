/**
 * Step 0 API contract (API-CONTRACT-step0.md): GET /landscape, /objects/{module}/receipt, /status, /command.
 * A value the backend has not stored is null and the UI shows a dash; nothing here is ever filled in client side.
 */

export type DimensionKey = "completeness" | "accuracy" | "consistency" | "timeliness" | "uniqueness" | "validity";

/** The six dimensions in ruler order, with the DAMA weights the score formula uses. */
export const DIMENSIONS: ReadonlyArray<{ key: DimensionKey; label: string; weight: number }> = [
  { key: "completeness", label: "Completeness", weight: 0.25 },
  { key: "accuracy", label: "Accuracy", weight: 0.25 },
  { key: "consistency", label: "Consistency", weight: 0.2 },
  { key: "timeliness", label: "Timeliness", weight: 0.1 },
  { key: "uniqueness", label: "Uniqueness", weight: 0.1 },
  { key: "validity", label: "Validity", weight: 0.1 },
];

export type Verdict = "no-go" | "at-risk" | "go";
export type SystemState = "analysed" | "extracted" | "not_extracted";

export interface StatusStrip {
  run_at: string | null;
  records_checked: number | null;
  rules_measured: number | null;
  scored_in_s: number | null;
  cost_model: string | null;
  licence_valid_to: string | null;
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
  features_blocked: number | null;
  features_degraded: number | null;
  open_work: number | null;
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
  status: string;
  top_message: string | null;
  top_field: string | null;
  suggested_value?: string | null;
  value_at_risk?: number | null;
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
