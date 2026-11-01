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

/** One context value a tuning proposal excludes: the record-key field, the rule column it maps to, and its verdicts. */
export interface TuningExclusion { field: string; column: string; value: string; false_positive: number; real: number }
/** A self-tuning proposal for a rule below target precision (GET /rule-tuning, checks/self_tune.py). */
export interface TuningProposal {
  rule_id: string;
  message: string;
  module: string;
  reviewed: number;
  precision_before: number;
  precision_after: number;
  kind: "exclude" | "severity";
  exclusions: TuningExclusion[];
  severity_from?: string;
  severity_to?: string;
  records_excluded: number;
  fp_removed: number;
  real_lost: number;
  rationale: string;
  /** Unified diff of the rule as it runs now against the proposal. */
  diff: string;
  /** A draft or in-review version already waiting; no new draft until it is decided. */
  pending: { version: number; state: string } | null;
}
export interface RuleTuning { target_precision: number; proposals: TuningProposal[] }
export interface DraftedVersion { rule_id: string; version: number; state: string }

export const getRuleTuning = (): Promise<RuleTuning> => v2Get("/rule-tuning");
export const draftTunedVersion = (ruleId: string): Promise<DraftedVersion> => v2Send("POST", `/rule-tuning/${enc(ruleId)}/draft`);
