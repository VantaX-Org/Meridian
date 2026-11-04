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

export interface FirewallRecord {
  index: number;
  verdict: "pass" | "block";
  failures: FirewallFailure[];
}

export interface FirewallVerdict {
  verdict: "pass" | "block";
  block_severity: string;
  module: string;
  rules_run: number;
  records: FirewallRecord[];
}

export const getFirewallSummary = (): Promise<FirewallSummary> => v2Get("/dq-firewall/summary");

export const validateRecords = (module: string, records: Record<string, string>[], suggest = false): Promise<FirewallVerdict> =>
  v2Send("POST", "/dq-firewall/validate", suggest ? { module, records, suggest } : { module, records });
