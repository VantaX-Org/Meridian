/** AI rule authoring. The server sends the model field names and aggregate
 *  statistics only; record values never leave the tenant. */
import { longApiClient } from "./client";
import apiClient from "./client";
import { optional } from "./optional";

export interface GeneratedRule {
  rule_yaml?: string;
  rule?: Record<string, unknown>;
  valid?: boolean;
  errors?: string[];
}

export interface DryRun {
  version_id?: string;
  evaluated?: boolean;
  reason?: string;
  hits?: number;
  population?: number;
  pass_rate?: number | null;
  sample?: Array<Record<string, unknown>>;
}

export interface AuthoredDraft {
  id: string;
  domain?: string;
  proposed_rule?: Record<string, unknown>;
  rationale?: string | null;
  status?: string;
  created_at?: string;
}

export interface AuthoringInput { module: string; rule_yaml: string; system_id?: string; rationale?: string }

export const generateRule = async (body: { module: string; description: string; system_id?: string }) =>
  (await longApiClient.post<GeneratedRule>("/api/v1/rule-authoring/generate", body)).data;

export const dryRunRule = async (body: AuthoringInput) =>
  (await longApiClient.post<DryRun>("/api/v1/rule-authoring/dry-run", body)).data;

export const saveRuleDraft = async (body: AuthoringInput) =>
  (await apiClient.post<{ id?: string; status?: string }>("/api/v1/rule-authoring/drafts", body)).data;

export const getRuleDrafts = (module?: string) =>
  optional(async () => (await apiClient.get<{ items?: AuthoredDraft[] }>("/api/v1/rule-authoring/drafts",
    { params: module ? { module } : {} })).data);
