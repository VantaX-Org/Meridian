/**
 * Match rules client: the field comparisons that score a pair of records as the same, per object.
 *
 * Endpoints (api/routes/match_rules.py, all need manage_rules):
 *   GET    /match-rules?domain=&active=   (rules by object, heaviest first)
 *   POST   /match-rules                   (add a rule)
 *   PUT    /match-rules/{id}              (change a rule)
 *   DELETE /match-rules/{id}              (remove a rule)
 *   POST   /match-rules/simulate          (score the latest pending pairs of an object with the active rules, writes nothing)
 * A pair scoring 95 or more is merged by itself, below 30 dismissed by itself, anything between goes to a steward.
 */
import { v2Get, v2Send } from "./client";

export const MATCH_TYPES = ["exact", "fuzzy", "phonetic", "numeric_range", "semantic"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/** The bands of api/services/merge_explain.py, as shares of 1. */
export const BANDS = { autoMerge: 0.95, reviewFloor: 0.3 } as const;

export interface MatchRule {
  id: string;
  tenant_id: string;
  domain: string;
  field: string;
  match_type: MatchType;
  weight: number;
  threshold: number;
  active: boolean;
}

export type MatchRuleInput = Pick<MatchRule, "domain" | "field" | "match_type" | "weight" | "threshold" | "active">;

export interface MatchSimulation {
  total_pairs: number;
  auto_merge_count: number;
  auto_dismiss_count: number;
  queue_count: number;
}

export const listMatchRules = () => v2Get<{ rules: MatchRule[]; total: number }>("/match-rules", {});
export const createMatchRule = (body: MatchRuleInput) => v2Send<MatchRule>("POST", "/match-rules", body);
export const updateMatchRule = (id: string, body: Partial<MatchRuleInput>) => v2Send<MatchRule>("PUT", `/match-rules/${encodeURIComponent(id)}`, body);
export const deleteMatchRule = (id: string) => v2Send<{ deleted: boolean }>("DELETE", `/match-rules/${encodeURIComponent(id)}`);
export const simulateMatchRules = (domain: string) => v2Send<MatchSimulation>("POST", "/match-rules/simulate", { domain });

/**
 * Match rules Aletheia proposes from steward corrections (api/routes/ai_feedback.py, needs review_ai_rules):
 *   GET  /ai/proposed-rules?status=pending        (proposals waiting for review)
 *   POST /ai/proposed-rules/{id}/approve          (copies the proposal into the match rules)
 *   POST /ai/proposed-rules/{id}/reject           (with an optional reason for the audit log)
 * A proposal already decided answers 400.
 */
export interface ProposedRule {
  id: string;
  tenant_id: string;
  domain: string;
  proposed_rule: { field?: string; match_type?: MatchType; weight?: number; threshold?: number };
  rationale: string;
  supporting_correction_count: number;
  status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export const PROPOSED_KEY = ["ai-proposed-rules"];
export const listProposedRules = () => v2Get<{ rules: ProposedRule[]; total: number }>("/ai/proposed-rules", { status: "pending" });
export const approveProposedRule = (id: string) => v2Send<{ id: string; status: string; match_rule_id: string }>("POST", `/ai/proposed-rules/${encodeURIComponent(id)}/approve`);
export const rejectProposedRule = (id: string, reason: string) => v2Send<{ id: string; status: string }>("POST", `/ai/proposed-rules/${encodeURIComponent(id)}/reject`, { reason: reason || null });
