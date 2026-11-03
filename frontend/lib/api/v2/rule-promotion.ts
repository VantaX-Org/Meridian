/**
 * Aletheia rule promotion client (api/routes/rule_promotion.py). Reads need `view`, every write needs `manage_rules`.
 *
 *   GET  /rule-promotion/modules                 objects with generated rules: pack size, promoted, last summary
 *   GET  /rule-promotion/preview?module=         dry run of each switched-off generated rule, sorted into a bucket
 *   POST /rule-promotion/apply                   enable the promote bucket (evidence is recomputed on the server)
 *   POST /rule-promotion/promote-anyway          enable review rules by hand, with a reason (audited)
 *   POST /rule-promotion/revert                  switch promoted rules back off
 *
 * Deterministic and local: no AI, and the evidence holds counts, rates and record keys only, never a field value.
 */
import { v2Get, v2Send } from "./client";

export type PromotionBucket = "promote" | "review" | "skip_unused" | "needs_value_set";

export interface PromotionModule {
  module: string;
  generated: number;
  promoted: number;
  summary: Record<PromotionBucket, number> | null;
  evaluated_at: string | null;
}

export interface PromotionThresholds {
  min_populated_pct: number;
  max_failure_rate: number;
  min_records: number;
  drift_delta: number;
}

export interface PromotionRule {
  id: string;
  field: string;
  field_text: string;
  check_class: string;
  severity: string;
  message: string;
  reference_key: string | null;
  bucket: PromotionBucket;
  reason: string;
  failing: number;
  total: number;
  rate: number | null;
  populated_pct: number | null;
  sample_keys: string[];
  promoted: boolean;
}

export interface PromotionDrift {
  id: string;
  baseline_rate: number;
  current_rate: number;
  delta: number;
  failing: number;
  total: number;
  sample_keys: string[];
}

export interface PromotionPreview {
  module: string;
  version_id: string | null;
  thresholds: PromotionThresholds;
  counts: Record<PromotionBucket, number>;
  promoted: number;
  drift: PromotionDrift[];
  rules: PromotionRule[];
  narrative: string;
}

export const getPromotionModules = (): Promise<{ modules: PromotionModule[] }> => v2Get("/rule-promotion/modules");
export const getPromotionPreview = (module: string): Promise<PromotionPreview> => v2Get("/rule-promotion/preview", { module });
export const applyPromotion = (module: string): Promise<{ enabled: string[] }> => v2Send("POST", "/rule-promotion/apply", { module });
export const promoteAnyway = (module: string, ruleIds: string[], reason: string): Promise<{ enabled: string[] }> =>
  v2Send("POST", "/rule-promotion/promote-anyway", { module, rule_ids: ruleIds, reason });
export const revertPromotion = (module: string, ruleIds?: string[]): Promise<{ reverted: string[] }> =>
  v2Send("POST", "/rule-promotion/revert", { module, rule_ids: ruleIds });
