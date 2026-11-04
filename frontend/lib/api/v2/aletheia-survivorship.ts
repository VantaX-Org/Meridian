/**
 * Aletheia verified survivorship client (api/routes/aletheia_survivorship.py).
 *
 *   GET  /aletheia/survivorship            model picks of a golden-record winner, per object counts and the newest picks with their checks and offered candidates
 *   POST /aletheia/survivorship/decision   a steward accepts a pick or overrides it with another offered source
 *   GET  /aletheia/survivorship/accuracy   acceptance and override rates by object, by field and by week
 *
 * The model sees only the shape of each source's value. A pick wins only when the server proved it. No value is
 * returned: a candidate is its source, the shape of its value and its length.
 */
import { v2Get, v2Send } from "./client";

export interface SurvivorshipCheck { code: string; passed: boolean }

export interface SurvivorshipCandidate { source_system: string; shape: string; length: number; blank: boolean; picked: boolean }

export type SurvivorshipState = "pending" | "accepted" | "overridden";

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
  candidates: SurvivorshipCandidate[];
}

export interface Survivorship {
  domains: { domain: string; verified: number; rejected: number }[];
  picks: SurvivorshipPick[];
}

export interface SurvivorshipDecisionBody {
  domain: string;
  sap_object_key: string;
  field: string;
  decision: "accept" | "override";
  source_system?: string;
  reason_code?: ReasonCode;
}

export interface SurvivorshipDecisionResult { decision: "accept" | "override"; prior_source: string; new_source: string; field: string }

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
