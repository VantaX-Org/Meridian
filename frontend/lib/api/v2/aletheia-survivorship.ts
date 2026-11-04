/**
 * Aletheia verified survivorship client (api/routes/aletheia_survivorship.py).
 *
 *   GET  /aletheia/survivorship            model picks of a golden-record winner, per object counts and the newest picks with their checks and offered candidates
 *   POST /aletheia/survivorship/decision   a steward approves (accept), overrides or rejects (with a reason) a proposed pick; not the user who triggered the run
 *   POST /aletheia/survivorship/decision/bulk   approve a list of picks, failures reported per pick
 *   GET/PUT /aletheia/survivorship/approval-setting   whether a proved AI pick waits for a steward's approval; on by default, off is an opt-in auto-approve (PUT needs manage_settings)
 *   GET  /aletheia/survivorship/accuracy   acceptance and override rates by object, by field and by week
 *
 * The model sees only the shape of each source's value. A pick wins only when the server proved it. No value is
 * returned: a candidate is its source, the shape of its value and its length.
 */
import { v2Get, v2Send } from "./client";

export interface SurvivorshipCheck { code: string; passed: boolean }

export interface SurvivorshipCandidate { source_system: string; shape: string; length: number; blank: boolean; picked: boolean }

export type SurvivorshipState = "pending" | "accepted" | "overridden" | "rejected";

export type ReasonCode = "wrong_source" | "stale_value" | "incomplete_value" | "format_issue" | "other";

export interface SurvivorshipPick {
  domain: string;
  sap_object_key: string;
  field: string;
  field_text?: string | null;
  recommended_source: string;
  confidence?: number | null;
  reasoning: string;
  verified: boolean;
  checks: SurvivorshipCheck[];
  applied: boolean;
  state: SurvivorshipState;
  decided_source?: string | null;
  reason_code?: string | null;
  note?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  candidates: SurvivorshipCandidate[];
}

/** Proved picks only: proposed waits for a steward, auto_applied was applied under the opt-in auto-approve. */
export interface SurvivorshipCounts { proposed: number; approved: number; rejected: number; auto_applied: number }

export interface Survivorship {
  domains: { domain: string; verified: number; rejected: number }[];
  counts: SurvivorshipCounts;
  picks: SurvivorshipPick[];
}

export interface SurvivorshipDecisionBody {
  domain: string;
  sap_object_key: string;
  field: string;
  decision: "accept" | "override" | "reject";
  source_system?: string;
  reason_code?: ReasonCode;
  /** Required for a rejection. */
  note?: string;
}

export interface SurvivorshipDecisionResult { decision: "accept" | "override" | "reject"; prior_source: string; new_source: string; field: string }

export interface AccuracyCounts { accepted: number; overridden: number; pending: number; acceptance_rate: number | null; override_rate: number | null }

export interface SurvivorshipAccuracy extends AccuracyCounts {
  by_object: (AccuracyCounts & { domain: string })[];
  by_field: (AccuracyCounts & { domain: string; field: string; field_text?: string | null })[];
  by_week: (AccuracyCounts & { week: string })[];
  reason_codes: { code: ReasonCode; text: string }[];
}

export const getSurvivorship = (): Promise<Survivorship> => v2Get<Survivorship>("/aletheia/survivorship");

export const getSurvivorshipAccuracy = (): Promise<SurvivorshipAccuracy> => v2Get<SurvivorshipAccuracy>("/aletheia/survivorship/accuracy");

export const postSurvivorshipDecision = (body: SurvivorshipDecisionBody): Promise<SurvivorshipDecisionResult> =>
  v2Send<SurvivorshipDecisionResult>("POST", "/aletheia/survivorship/decision", body);

export interface SurvivorshipBulkResult { approved: number; failed: { domain: string; sap_object_key: string; field: string; detail: string }[] }

export const postSurvivorshipBulkApprove = (picks: { domain: string; sap_object_key: string; field: string }[]): Promise<SurvivorshipBulkResult> =>
  v2Send<SurvivorshipBulkResult>("POST", "/aletheia/survivorship/decision/bulk", { picks });

export interface ApprovalSetting { required: boolean }

export const getApprovalSetting = (): Promise<ApprovalSetting> => v2Get<ApprovalSetting>("/aletheia/survivorship/approval-setting");

export const putApprovalSetting = (body: ApprovalSetting): Promise<ApprovalSetting> =>
  v2Send<ApprovalSetting>("PUT", "/aletheia/survivorship/approval-setting", body);
