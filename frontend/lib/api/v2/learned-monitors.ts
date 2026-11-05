/**
 * Learned monitors client: breaks from the baseline Meridian learns from its own earlier runs.
 *
 * Endpoints (api/routes/learned_monitors.py):
 *   GET  /aletheia/monitors                  the latest run's breaks and, per object, how many earlier runs its baseline has;
 *                                            `interim`: volume breaks found between full runs (extraction landed, analysis pending)
 *   POST /aletheia/monitors/{id}/acknowledge { note? }  also confirms a below_minimum break as real, which lowers the minimum
 *   POST /aletheia/monitors/{id}/expected    { effect: "exclude" | "accept", note? }  mark expected; feeds the baseline
 *   POST /aletheia/monitors/{id}/snooze      { days, note? }
 *   POST /aletheia/monitors/{id}/explain     Aletheia's wording of the figures; aggregates only, never a record
 * Decisions need mdm.write. An object with fewer earlier runs than min_runs is "learning" and raises nothing.
 */
import { v2Get, v2Send } from "./client";

export type BreakKind = "volume_drop" | "volume_spike" | "fail_rate_jump" | "score_drop" | "field_emptied" | "cardinality_shift";
export type BreakMetric = "records" | "score" | "fail_rate" | "blank_pct" | "distinct_pct";
export type BreakStatus = "open" | "acknowledged" | "expected" | "snoozed" | "below_minimum";

export interface BreakCitation {
  run_id: string;
  run_number: number | null;
  run_at: string | null;
  role: "baseline" | "current";
}

export interface LearnedBreak {
  id: string;
  version_id: string;
  run_number: number | null;
  module: string;
  kind: BreakKind;
  metric: BreakMetric;
  /** A rule id for fail_rate, TABLE.FIELD for blank_pct and distinct_pct, empty for records and score. */
  subject_code: string;
  subject_description: string | null;
  severity: "critical" | "high" | "medium" | "low";
  expected_low: number | null;
  expected_high: number | null;
  median: number | null;
  observed: number;
  baseline_runs: number;
  method: string;
  status: BreakStatus;
  baseline_effect: "exclude" | "accept" | null;
  snoozed_until: string | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  explanation: { source: "ai" | "template"; sentences: string[]; dropped: number };
  citations: BreakCitation[];
  detected_at: string;
  /** run: from a finished analysis run. interim: found between full runs, from the rows a sync extracted. */
  source: "run" | "interim";
}

export interface MonitorCoverage {
  module: string;
  run_id: string;
  run_number: number | null;
  baseline_runs: number;
  min_runs: number;
  state: "learning" | "active";
  breaks: number;
}

export interface ThresholdMove {
  break_id: string;
  run_number: number | null;
  decision: "expected" | "confirmed";
  effect: number;
  result: "raised" | "lowered" | "kept";
  min_effect_after: number;
  decided_by: string | null;
  decided_at: string | null;
}

/** One monitor's learned minimum effect. Records: a share of the median (0.3 is 30%); score and fail rate: points. */
export interface MonitorThreshold {
  module: string;
  metric: "records" | "score" | "fail_rate" | "blank_pct" | "distinct_pct";
  subject_code: string;
  subject_description: string | null;
  min_effect: number;
  floor: number;
  ceiling: number;
  window_days: number;
  moves: ThresholdMove[];
}

export interface LearnedMonitors {
  min_runs: number;
  history: number;
  coverage: MonitorCoverage[];
  breaks: LearnedBreak[];
  /** Outside the usual range but under a raised learned minimum: no alert, not counted open. Acknowledge confirms one and lowers the minimum. */
  below_minimum: LearnedBreak[];
  thresholds: MonitorThreshold[];
  /** Volume breaks of syncs whose extraction landed after the latest finished run and whose analysis has not finished. */
  interim: LearnedBreak[];
}

export const getLearnedMonitors = (): Promise<LearnedMonitors> => v2Get("/aletheia/monitors");

const act = (id: string, verb: string, body: unknown = {}): Promise<LearnedBreak> =>
  v2Send("POST", `/aletheia/monitors/${id}/${verb}`, body);

export const acknowledgeBreak = (id: string, note?: string) => act(id, "acknowledge", { note });
export const expectBreak = (id: string, effect: "exclude" | "accept", note?: string) => act(id, "expected", { effect, note });
export const snoozeBreak = (id: string, days: number, note?: string) => act(id, "snooze", { days, note });
export const explainBreak = (id: string) => act(id, "explain");
