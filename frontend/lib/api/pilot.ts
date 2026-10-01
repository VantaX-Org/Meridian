import apiClient from "./client";

/** Precision of one rule on one system, from steward decisions on its record issues. */
export interface RuleScore {
  check_id: string;
  module: string;
  severity: string;
  message: string | null;
  flagged: number;
  open: number;
  false_positive: number;
  /** Reviewed and confirmed: fixed in SAP, verified fixed by a later run, or accepted risk. */
  real: number;
  reviewed: number;
  precision: number | null;
  /** At least `min_reviewed_per_rule` reviewed issues. */
  rated: boolean;
  needs_tuning: boolean;
}

export interface KnownIssue {
  module: string;
  record_ref: string;
  note: string | null;
}

export interface Scorecard {
  precision: {
    reviewed: number;
    false_positives: number;
    precision: number | null;
    min_reviewed_per_rule: number;
    target: number;
  };
  rules: RuleScore[];
  recall: {
    known: number;
    caught: number;
    recall: number | null;
    missed: KnownIssue[];
    missed_total: number;
    objects_not_analysed: string[];
  };
}

const base = (id: string) => `/api/v1/systems/${id}/pilot`;

export async function getScorecard(id: string): Promise<Scorecard> {
  return (await apiClient.get(`${base(id)}/scorecard`)).data;
}

/** CSV object,record,note — records the stewards know are wrong. Replaces the system's current list. */
export async function uploadKnownIssues(id: string, csv: File): Promise<{ records: number; rejected: number }> {
  return (
    await apiClient.post(`${base(id)}/known-issues`, await csv.text(), { headers: { "Content-Type": "text/csv" } })
  ).data;
}
