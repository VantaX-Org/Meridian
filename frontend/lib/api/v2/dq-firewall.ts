import { v2Get, v2Send } from "./client";

/** The real-time data-quality firewall (api/routes/dq_firewall.py): candidate records in, failing rules out. */
export interface FirewallSummary {
  modules: string[];
  max_records: number;
  block_severity: string;
  calls_24h: number;
  calls_7d: number;
  last_call_at: string | null;
  /** One row per day, oldest first. warned and passed are null for days before they were recorded. */
  days: FirewallDay[];
  top_rules: FirewallTopRule[];
  by_module: FirewallModuleRow[];
  /** The latest change requests opened from the gate. */
  requests: GateRequest[];
}

/** A change request the gate opened for a flagged record. */
export interface GateRequest {
  id: string;
  object: "material" | "customer" | "vendor" | "business_partner";
  title: string | null;
  status: "draft" | "submitted" | "in_approval" | "approved" | "rejected" | "creating" | "created" | "failed" | "cancelled";
  created_at: string;
}

export interface FirewallDay {
  day: string;
  checked: number;
  blocked: number;
  warned: number | null;
  passed: number | null;
}

export interface FirewallTopRule {
  rule_id: string;
  description: string;
  blocked: number;
}

export interface FirewallModuleRow {
  module: string;
  checked: number;
  blocked: number;
  warned: number | null;
  passed: number | null;
}

/** A grounded fix: a corrected value from the rule's own auto-fix steps, or the values the rule accepts. */
export interface FirewallSuggestion {
  kind: "value" | "allowed_values";
  field: string;
  rule_id: string;
  source: string;
  verified: boolean;
  value?: string | null;
  allowed_values?: { code: string; text: string | null }[] | null;
  truncated?: boolean | null;
}

export interface FirewallFailure {
  rule_id: string;
  description: string;
  field: string;
  severity: "critical" | "high" | "medium" | "low";
  dimension: string;
  reason: string;
  suggestion?: FirewallSuggestion | null;
}

/** One compared field of a likely duplicate. The other record's values are never returned. */
export interface DuplicateField {
  field: string;
  comparator: string;
  similarity: number;
  weight: number;
  threshold: number | null;
  met: boolean;
}

export interface DuplicateMatch {
  /** The existing record's key. */
  key: string;
  /** "exact": same normalised value. "similar": found by the typo-tolerant pass on a free-text field. */
  found_by: "exact" | "similar";
  score: number;
  band: string;
  /** The auto-merge threshold the score is judged against. */
  threshold: number;
  fields: DuplicateField[];
}

export type FuzzyNotRun = "extension_missing" | "index_missing" | "key_too_short" | "no_free_text_value" | "not_searched";

export interface RecordDuplicates {
  /** "warn" when a match reaches the auto-merge threshold; never "block". */
  verdict: "pass" | "warn";
  /** False: the record had no value to look up, so "pass" does not mean "no duplicates". */
  searched: boolean;
  scored: number;
  truncated: boolean;
  matches: DuplicateMatch[];
  /** ran false: a typo in this record's names was not looked for; the exact pass still ran. */
  fuzzy: { ran: boolean; reason?: FuzzyNotRun | null };
}

export type DuplicateNotSearched = "module_not_supported" | "no_match_rules" | "no_population" | "no_block_field_in_population";

export interface DuplicateSearch {
  searched: boolean;
  reason?: DuplicateNotSearched | null;
  cap: number;
  thresholds: Record<string, number>;
  rules?: number | null;
  skipped_semantic?: number | null;
  /** Whether the typo-tolerant pass can run at all; absent when nothing was searched. */
  fuzzy?: { available: boolean; reason?: FuzzyNotRun | null; min_key_length: number; similarity: number } | null;
}

export type StewardNotOpened = "module_has_no_change_request" | "over_limit" | "not_accepted" | "not_opened";

/** What route_to_steward did for a flagged record: the request id, or the reason none was opened. */
export interface StewardRequest {
  request_id?: string | null;
  status?: GateRequest["status"] | null;
  /** True: the same candidate already had this open request, so none was added. */
  existing?: boolean;
  reason?: StewardNotOpened | null;
  detail?: string | null;
}

export interface FirewallRecord {
  index: number;
  verdict: "pass" | "block";
  failures: FirewallFailure[];
  duplicates?: RecordDuplicates | null;
  steward_request?: StewardRequest | null;
}

export interface FirewallVerdict {
  verdict: "pass" | "block";
  block_severity: string;
  module: string;
  rules_run: number;
  records: FirewallRecord[];
  duplicate_search?: DuplicateSearch | null;
}

export const getFirewallSummary = (): Promise<FirewallSummary> => v2Get("/dq-firewall/summary");

export const validateRecords = (module: string, records: Record<string, string>[], opts: { suggest?: boolean; duplicates?: boolean; route_to_steward?: boolean } = {}): Promise<FirewallVerdict> =>
  v2Send("POST", "/dq-firewall/validate", {
    module,
    records,
    ...(opts.suggest ? { suggest: true } : {}),
    ...(opts.duplicates ? { duplicates: true } : {}),
    ...(opts.route_to_steward ? { route_to_steward: true } : {}),
  });
