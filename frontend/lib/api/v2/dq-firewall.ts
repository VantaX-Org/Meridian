import { v2Get, v2Send } from "./client";

/** The real-time data-quality firewall (api/routes/dq_firewall.py): candidate records in, failing rules out. */
export interface FirewallSummary {
  modules: string[];
  max_records: number;
  block_severity: string;
  calls_24h: number;
  calls_7d: number;
  last_call_at: string | null;
}

export interface FirewallFailure {
  rule_id: string;
  description: string;
  field: string;
  severity: "critical" | "high" | "medium" | "low";
  dimension: string;
  reason: string;
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

export const validateRecords = (module: string, records: Record<string, string>[]): Promise<FirewallVerdict> =>
  v2Send("POST", "/dq-firewall/validate", { module, records });
