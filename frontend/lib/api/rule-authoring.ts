import apiClient from "./client";
import type { RuleVersion } from "./rules";

/** Body of every rule-authoring call: one rule as YAML. `module` picks the dictionary and the extraction to test on. */
export interface RuleAuthoringBody {
  module: string;
  rule_yaml: string;
  system_id?: string;
  rationale?: string;
}

export interface RuleGenerateBody {
  module: string;
  description: string;
  system_id?: string;
}

export interface GeneratedRule {
  rule_yaml: string;
  rule: Record<string, unknown> | null;
  valid: boolean;
  errors: string[];
}

export type RuleDraftDryRun =
  | { version_id: string; evaluated: true; hits: number; population: number; pass_rate: number; sample: Record<string, string>[] }
  | { version_id: string; evaluated: false; reason: string };

export interface SavedDraft {
  id: string;
  status: "draft";
  rule: Record<string, unknown>;
}

export interface PublishedDraftRule {
  id: string;
  name: string;
  module: string;
  severity: string;
  enabled: boolean;
  draft_id: string;
}

const BASE = "/api/v1/rule-authoring";

/** POST /api/v1/rule-authoring/generate: plain English to rule YAML. The result is a draft for the form, never published. */
export async function generateRuleDraft(body: RuleGenerateBody): Promise<GeneratedRule> {
  const { data } = await apiClient.post<GeneratedRule>(`${BASE}/generate`, body);
  return data;
}

/** POST /api/v1/rule-authoring/dry-run: run the rule on the module's latest extraction; writes nothing. */
export async function dryRunRuleDraft(body: RuleAuthoringBody): Promise<RuleDraftDryRun> {
  const { data } = await apiClient.post<RuleDraftDryRun>(`${BASE}/dry-run`, body);
  return data;
}

/** POST /api/v1/rule-authoring/drafts */
export async function createRuleDraft(body: RuleAuthoringBody): Promise<SavedDraft> {
  const { data } = await apiClient.post<SavedDraft>(`${BASE}/drafts`, body);
  return data;
}

/** PUT /api/v1/rule-authoring/drafts/{id} */
export async function updateRuleDraft(id: string, body: RuleAuthoringBody): Promise<SavedDraft> {
  const { data } = await apiClient.put<SavedDraft>(`${BASE}/drafts/${encodeURIComponent(id)}`, body);
  return data;
}

/** DELETE /api/v1/rule-authoring/drafts/{id} */
export async function deleteRuleDraft(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/drafts/${encodeURIComponent(id)}`);
}

/** POST /api/v1/rule-authoring/drafts/{id}/publish: creates the tenant rule and removes the draft. */
export async function publishRuleDraft(id: string): Promise<PublishedDraftRule> {
  const { data } = await apiClient.post<PublishedDraftRule>(`${BASE}/drafts/${encodeURIComponent(id)}/publish`);
  return data;
}

export type RuleVersionState = "draft" | "in_review" | "active" | "retired";

/** Moves the server accepts (checks/lifecycle.py TRANSITIONS); the API stays the authority and answers 409 or 403 otherwise. */
export const RULE_VERSION_TRANSITIONS: Record<RuleVersionState, RuleVersionState[]> = {
  draft: ["in_review"],
  in_review: ["draft", "active"],
  active: ["retired"],
  retired: [],
};

export function allowedVersionTargets(state: string): RuleVersionState[] {
  return RULE_VERSION_TRANSITIONS[state as RuleVersionState] ?? [];
}

/** POST /api/v1/rules/{ruleId}/versions/{version}/transition */
export async function transitionRuleVersion(
  ruleId: string,
  version: number,
  body: { to: RuleVersionState; note?: string },
): Promise<RuleVersion> {
  const { data } = await apiClient.post<RuleVersion>(
    `/api/v1/rules/${encodeURIComponent(ruleId)}/versions/${version}/transition`,
    body,
  );
  return data;
}
