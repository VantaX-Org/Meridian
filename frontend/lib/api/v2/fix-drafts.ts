/**
 * Aletheia verified fixes client (api/routes/aletheia_fix_drafts.py). Reads need `view`, every write needs `manage_rules`.
 *
 *   GET  /aletheia/fix-drafts/coverage            rules per object and how many carry an auto_fix
 *   GET  /aletheia/fix-drafts                     stored drafts (pending, approved, rejected)
 *   POST /aletheia/fix-drafts                     draft and verify a fix for one rule; stored pending, never applied
 *   POST /aletheia/fix-drafts/{rule}/approve      a steward approves; the steps then act as the rule's auto_fix
 *   POST /aletheia/fix-drafts/{rule}/reject       a steward rejects
 *
 * The drafter sees only the aggregated shape of the failing values (masks, lengths, case), never a value.
 */
import { v2Get, v2Send } from "./client";

export interface FixShape {
  total_failing: number;
  blank: number;
  masks: { mask: string; count: number }[];
  other_masks: number;
  lengths: { length: number; count: number }[];
  case: Record<string, number>;
  leading_ws: number;
  trailing_ws: number;
  inner_ws: number;
  legend: Record<string, string>;
}

export interface FixVerification {
  failing: number;
  fixed: number;
  rejected: number;
  still_failing: number;
  touched_passing: number;
  broken: number;
}

export type FixStatus = "pending" | "approved" | "rejected" | "none";

export interface FixDraft {
  rule_id: string;
  module?: string | null;
  field: string;
  rule_text?: string | null;
  field_text?: string | null;
  status: FixStatus;
  source?: "llm" | "deterministic" | null;
  steps: Record<string, unknown>[];
  confidence?: string | null;
  shape: FixShape;
  verification?: FixVerification | null;
  errors: string[];
  llm_tried: boolean;
  drafted_at?: string | null;
  decided_at?: string | null;
  decided_by?: string | null;
  note?: string | null;
}

export interface FixCoverage {
  module: string;
  rules: number;
  with_fix: number;
}

export const getFixCoverage = (): Promise<{ modules: FixCoverage[] }> => v2Get("/aletheia/fix-drafts/coverage");
export const getFixDrafts = (): Promise<{ drafts: FixDraft[] }> => v2Get("/aletheia/fix-drafts");
export const draftFix = (module: string, ruleId: string, useLlm = true): Promise<FixDraft> =>
  v2Send("POST", "/aletheia/fix-drafts", { module, rule_id: ruleId, use_llm: useLlm });
export const approveFix = (ruleId: string, note?: string): Promise<FixDraft> => v2Send("POST", `/aletheia/fix-drafts/${ruleId}/approve`, { note });
export const rejectFix = (ruleId: string, note?: string): Promise<FixDraft> => v2Send("POST", `/aletheia/fix-drafts/${ruleId}/reject`, { note });
