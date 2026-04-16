import apiClient from "./client";
import type {
  MatchRule,
  MatchRulesListResponse,
  AIProposedRule,
  AIProposedRulesListResponse,
  SimulationResult,
} from "@/types/api";

// ── Match Rules CRUD ────────────────────────────────────────────────────────

export async function getMatchRules(
  domain?: string,
  active?: boolean,
): Promise<MatchRulesListResponse> {
  const params: Record<string, string | boolean> = {};
  if (domain) params.domain = domain;
  if (active !== undefined) params.active = active;
  const { data } = await apiClient.get("/api/v1/match-rules", { params });
  return data;
}

export async function createMatchRule(body: {
  domain: string;
  field: string;
  match_type: string;
  weight: number;
  threshold: number;
  active?: boolean;
}): Promise<MatchRule> {
  const { data } = await apiClient.post("/api/v1/match-rules", body);
  return data;
}

export async function updateMatchRule(
  id: string,
  body: Partial<{
    domain: string;
    field: string;
    match_type: string;
    weight: number;
    threshold: number;
    active: boolean;
  }>,
): Promise<MatchRule> {
  const { data } = await apiClient.put(`/api/v1/match-rules/${id}`, body);
  return data;
}

export async function deleteMatchRule(id: string): Promise<{ deleted: boolean }> {
  const { data } = await apiClient.delete(`/api/v1/match-rules/${id}`);
  return data;
}

export async function simulateMatchRules(body: {
  domain: string;
}): Promise<SimulationResult> {
  const { data } = await apiClient.post("/api/v1/match-rules/simulate", body);
  return data;
}

// ── AI Proposed Rules ───────────────────────────────────────────────────────

export async function getProposedRules(
  status?: string,
  domain?: string,
): Promise<AIProposedRulesListResponse> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  if (domain) params.domain = domain;
  const { data } = await apiClient.get("/api/v1/ai/proposed-rules", { params });
  return data;
}

export async function approveProposedRule(
  id: string,
): Promise<{ id: string; status: string; match_rule_id: string }> {
  const { data } = await apiClient.post(`/api/v1/ai/proposed-rules/${id}/approve`);
  return data;
}

export async function rejectProposedRule(
  id: string,
): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/ai/proposed-rules/${id}/reject`);
  return data;
}

// ── AI Feedback ─────────────────────────────────────────────────────────────

export async function submitAiFeedback(body: {
  queue_item_id: string;
  steward_decision: string;
  correction_reason?: string;
  domain: string;
}): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/ai/feedback", body);
  return data;
}
