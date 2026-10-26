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

/** One rule as PUT /survivorship-rules takes it (api/routes/survivorship_rules.py SurvivorshipRuleBody). */
export type SurvivorshipRuleInput = Pick<SurvivorshipRule, "field" | "rule_type" | "trusted_sources" | "weight" | "active">;

/** Replace every rule of one domain with `rules`: a rule of the domain left out is deleted. */
export async function putSurvivorshipRules(domain: string, rules: SurvivorshipRuleInput[]): Promise<{ rules: SurvivorshipRule[]; total: number }> {
  return (await apiClient.put("/api/v1/survivorship-rules", { domain, rules })).data;
}

export async function getSurvivorshipRules(domain?: string): Promise<{ rules: SurvivorshipRule[]; total: number }> {
  return (await apiClient.get("/api/v1/survivorship-rules", { params: domain ? { domain } : undefined })).data;
}
