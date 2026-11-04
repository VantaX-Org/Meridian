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
  score: number;
  band: string;
  /** The auto-merge threshold the score is judged against. */
  threshold: number;
  fields: DuplicateField[];
}

export interface RecordDuplicates {
  /** "warn" when a match reaches the auto-merge threshold; never "block". */
  verdict: "pass" | "warn";
  scored: number;
  truncated: boolean;
  matches: DuplicateMatch[];
}

export type DuplicateNotSearched = "module_not_supported" | "no_match_rules" | "no_population";

export interface DuplicateSearch {
  searched: boolean;
  reason?: DuplicateNotSearched | null;
  cap: number;
  thresholds: Record<string, number>;
  rules?: number | null;
  skipped_semantic?: number | null;
}

export interface FirewallRecord {
  index: number;
  verdict: "pass" | "block";
  failures: FirewallFailure[];
  duplicates?: RecordDuplicates | null;
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

export const validateRecords = (module: string, records: Record<string, string>[], opts: { suggest?: boolean; duplicates?: boolean } = {}): Promise<FirewallVerdict> =>
  v2Send("POST", "/dq-firewall/validate", {
    module,
    records,
    ...(opts.suggest ? { suggest: true } : {}),
    ...(opts.duplicates ? { duplicates: true } : {}),
  });
