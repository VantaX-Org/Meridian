/**
 * Rule lifecycle, feedback, suppressions and alert channels.
 * Every field is optional: older servers omit them, and a missing endpoint
 * resolves to null through `optional`.
 */
import apiClient from "./client";
import { optional } from "./optional";

export type RuleVersionState = "draft" | "in_review" | "active" | "retired";

export interface RuleVersion {
  rule_id?: string;
  version: number;
  body?: Record<string, unknown>;
  state?: RuleVersionState;
  note?: string | null;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RuleVersions {
  rule_id?: string;
  shipped?: { source?: string; hash?: string; app_version?: string; rule?: Record<string, unknown> } | null;
  versions?: RuleVersion[];
}

export interface RuleRun {
  version_id?: string;
  run_at?: string;
  module?: string;
  severity?: string;
  affected_count?: number;
  total_count?: number;
  pass_rate?: number | null;
  suppressed?: number;
  hit_rate?: number | null;
}

export interface RuleFeedback {
  rules?: Array<{ check_id: string; flagged?: number; false_positive?: number; real?: number; false_positive_rate?: number | null }>;
  reasons?: Array<{ reason: string; records?: number; last_at?: string }>;
}

export interface Suppression {
  id: string;
  check_id: string;
  record_key?: string | null;
  reason?: string;
  expires_at?: string;
  created_by?: string | null;
  created_at?: string;
  active?: boolean;
}

export type ChannelKind = "webhook" | "slack" | "teams" | "email";
export type Digest = "daily" | "weekly" | "off";

export interface AlertChannel {
  id: string;
  kind?: ChannelKind;
  target?: string;
  digest?: Digest;
  immediate_critical?: boolean;
  enabled?: boolean;
  has_secret?: boolean;
  created_at?: string;
}

const enc = encodeURIComponent;

export const getRuleVersions = (checkId: string) =>
  optional(async () => (await apiClient.get<RuleVersions>(`/api/v1/rules/${enc(checkId)}/versions`)).data);

export const createRuleVersion = async (checkId: string, body: Record<string, unknown>, note?: string) =>
  (await apiClient.post<RuleVersion>(`/api/v1/rules/${enc(checkId)}/versions`, { body, note })).data;

export const getRuleDiff = async (checkId: string, version: number) =>
  (await apiClient.get<{ from?: number | string | null; to?: number; diff?: string }>(
    `/api/v1/rules/${enc(checkId)}/versions/${version}/diff`)).data;

export const transitionRuleVersion = async (checkId: string, version: number, to: RuleVersionState, note?: string) =>
  (await apiClient.post<RuleVersion>(`/api/v1/rules/${enc(checkId)}/versions/${version}/transition`, { to, note })).data;

export const getRuleHistory = (checkId: string, limit = 30) =>
  optional(async () => (await apiClient.get<{ runs?: RuleRun[] }>(`/api/v1/rules/${enc(checkId)}/history`, { params: { limit } })).data);

export const getRuleFeedback = (checkId?: string) =>
  optional(async () => (await apiClient.get<RuleFeedback>("/api/v1/rule-feedback", { params: checkId ? { check_id: checkId } : {} })).data);

export const getSuppressions = (includeExpired = false) =>
  optional(async () => (await apiClient.get<{ suppressions?: Suppression[] }>("/api/v1/rule-suppressions",
    { params: { include_expired: includeExpired } })).data);

export const createSuppression = async (body: { check_id: string; record_key?: string; reason: string; expires_at: string }) =>
  (await apiClient.post<Suppression>("/api/v1/rule-suppressions", body)).data;

export const endSuppression = async (id: string) => {
  await apiClient.delete(`/api/v1/rule-suppressions/${enc(id)}`);
};

export const getAlertChannels = () =>
  optional(async () => (await apiClient.get<{ channels?: AlertChannel[] }>("/api/v1/alert-channels")).data);

export const createAlertChannel = async (body: {
  kind: ChannelKind; target: string; secret?: string; digest: Digest; immediate_critical: boolean;
}) => (await apiClient.post<AlertChannel>("/api/v1/alert-channels", body)).data;

export const deleteAlertChannel = async (id: string) => {
  await apiClient.delete(`/api/v1/alert-channels/${enc(id)}`);
};
