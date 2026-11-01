/** Pilot scorecard: how accurate the rules are, from reviewer verdicts and a list of known bad records (api/routes/pilot.py). */
import { fixtureActive } from "./fixture";
import { v2Get, v2Send } from "./client";

const enc = encodeURIComponent;

export interface ScorecardRule {
  check_id: string;
  module: string;
  severity: string;
  message: string;
  flagged: number;
  open: number;
  false_positive: number;
  real: number;
  reviewed: number;
  /** 0 to 1, or null when too few were reviewed. */
  precision: number | null;
  rated: boolean;
  needs_tuning: boolean;
}
export interface MissedRecord { module: string; record_ref: string; note: string | null }
export interface Scorecard {
  precision: { reviewed: number; false_positives: number; precision: number | null; min_reviewed_per_rule: number; target: number };
  rules: ScorecardRule[];
  recall: { known: number; caught: number; recall: number | null; missed: MissedRecord[]; missed_total: number; objects_not_analysed: string[] };
}
export interface KnownIssuesResult { records: number; rejected: number }

export const getScorecard = (systemId: string): Promise<Scorecard> => v2Get(`/systems/${enc(systemId)}/pilot/scorecard`);

/** The CSV goes as the raw body (text/csv): a JSON content type would quote it. */
export async function uploadKnownIssues(systemId: string, csv: string): Promise<KnownIssuesResult> {
  const path = `/systems/${enc(systemId)}/pilot/known-issues`;
  if (fixtureActive()) return v2Send<KnownIssuesResult>("POST", path, csv);
  const { default: client } = await import("@/lib/api/client");
  const { data } = await client.post<KnownIssuesResult>(`/api/v1${path}`, csv, { headers: { "Content-Type": "text/csv" } });
  return data;
}
