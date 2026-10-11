import apiClient from "./client";

export type SurvivorshipRuleType =
  | "most_recent" | "most_complete" | "most_frequent" | "trusted_source" | "chain" | "manual_override";

export interface SurvivorshipRule {
  id: string;
  domain: string;
  field: string;
  rule_type: SurvivorshipRuleType;
  trusted_sources: string[] | null;
  weight: number;
  active: boolean;
  ai_inferred: boolean;
}

export async function getSurvivorshipRules(domain?: string): Promise<{ rules: SurvivorshipRule[]; total: number }> {
  return (await apiClient.get("/api/v1/survivorship-rules", { params: domain ? { domain } : undefined })).data;
}
