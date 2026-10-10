import apiClient from "./client";

export type LearnedKind = "dependency" | "value_set" | "format" | "range";
export type LearnedStatus = "pending" | "approved" | "rejected";
export type Severity = "critical" | "high" | "medium" | "low";
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface LearnedRule {
  id: string;
  version_id: string | null;
  module: string;
  kind: LearnedKind;
  table_name: string;
  determinant: string | null;
  field: string;
  body: { [k: string]: JsonValue };
  confidence: number;
  support_rows: number;
  violations: number;
  sample_keys: string[];
  status: LearnedStatus;
  rule_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  updated_at: string;
}

export const KIND_LABEL: Record<LearnedKind, string> = {
  dependency: "Decided by another field",
  value_set: "Limited value set",
  format: "Format",
  range: "Numeric range",
};

export async function getLearnedRules(status: LearnedStatus, kind?: LearnedKind): Promise<{ items: LearnedRule[] }> {
  const { data } = await apiClient.get<{ items: LearnedRule[] }>("/api/v1/learned-rules", { params: { status, kind } });
  return data;
}

export async function approveLearnedRule(id: string, severity: Severity): Promise<{ id: string; status: "approved"; rule_id: string }> {
  const { data } = await apiClient.post<{ id: string; status: "approved"; rule_id: string }>(`/api/v1/learned-rules/${id}/approve`, { severity });
  return data;
}

export async function rejectLearnedRule(id: string): Promise<{ id: string; status: "rejected" }> {
  const { data } = await apiClient.post<{ id: string; status: "rejected" }>(`/api/v1/learned-rules/${id}/reject`, {});
  return data;
}
