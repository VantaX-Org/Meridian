/**
 * Action centre client: what needs the viewer's attention, ranked by tier, severity, count and age, filtered to what
 * their role may act on (api/routes/attention.py). The list is built at most 60 seconds before `generated_at`.
 *
 *   GET /attention?kinds=&object=&system_id=&limit=   (counts cover every matching item, items the first `limit`)
 *   GET /attention/count                              (counts by severity and the top item)
 */
import { v2Get } from "./client";

export interface AttentionItem {
  id: string;
  kind: string;
  tier: number;
  severity: string;
  title: string;
  detail: string;
  href: string;
  action_label: string;
  count: number;
  object: string | null;
  system_id: string | null;
  system_name: string | null;
  module: string | null;
  since: string | null;
  required_action: string;
}

export interface AttentionCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export const ATTENTION_LIMIT = 200;

export const getAttention = (q: { kinds?: string; system_id?: string }) =>
  v2Get<{ items: AttentionItem[]; generated_at: string; counts: AttentionCounts }>(
    "/attention",
    Object.fromEntries(Object.entries({ ...q, limit: ATTENTION_LIMIT }).filter(([, v]) => v !== undefined && v !== "")),
  );
