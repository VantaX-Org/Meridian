import apiClient from "./client";

export interface Rule {
  id: string;
  name: string;
  description: string | null;
  module: string;
  category: "ecc" | "successfactors" | "warehouse";
  severity: "critical" | "high" | "medium" | "low" | "info";
  enabled: boolean;
  conditions: object[];
  thresholds: object | null;
  tags: string[] | null;
  source_yaml: string | null;
  source: "yaml" | "hq";
  created_at: string;
  updated_at: string;
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
  count: number;
}

export async function getRules(params?: {
  category?: string;
  module?: string;
  severity?: string;
  enabled?: boolean;
  search?: string;
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
