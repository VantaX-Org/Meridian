import apiClient from "./client";

/** What a to-do item asks of a person, as api/services/attention.py names it. */
export type AttentionKind = string;
export type AttentionSeverity = "critical" | "high" | "medium" | "low";

/** One thing that needs a person, written server-side from one template per kind (api/routes/attention.py). */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /** 1 blocked work, 2 data regression, 3 freshness, 4 hygiene, 5 admin. */
  tier: number;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  action_label: string;
  count: number;
  object: string | null;
  system_id: string | null;
  system_name: string | null;
  module: string | null;
  /** ISO time the condition began. */
  since: string | null;
  required_action: string;
}

export interface AttentionCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AttentionList {
  items: AttentionItem[];
  /** ISO time the tenant's list was built; at most 60 s old. */
  generated_at: string;
  counts: AttentionCounts;
}

export interface AttentionCount extends AttentionCounts {
  top: AttentionItem | null;
}

export interface AttentionQuery {
  limit?: number;
  kinds?: readonly string[];
  /** An object (module) id. */
  object?: string;
  system_id?: string;
}

/** The viewer's ranked list: tier, then severity, count and age. Items are already filtered to what they may act on. */
export async function getAttention(query: AttentionQuery = {}): Promise<AttentionList> {
  const { kinds, ...rest } = query;
  const { data } = await apiClient.get<AttentionList>("/api/v1/attention", {
    params: { ...rest, ...(kinds?.length ? { kinds: kinds.join(",") } : {}) },
  });
  return data;
}

/** Counts by severity and the top item, for the Rail badge and the home verdict button. */
export async function getAttentionCount(): Promise<AttentionCount> {
  const { data } = await apiClient.get<AttentionCount>("/api/v1/attention/count");
  return data;
}

/** The badge number: items that need a person soon (critical and high). */
export const attentionBadge = (c: AttentionCounts): number => c.critical + c.high;

/** The refetch cadence of the count, as the shell counts. */
export const ATTENTION_POLL_MS = 60_000;
