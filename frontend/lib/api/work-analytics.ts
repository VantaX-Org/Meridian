// The lead's analytics over the fix work (api/routes/work_analytics.py): how fast the data is getting fixed,
// and what is slowing it down. Every number is computed in the database; this module only types it.
import apiClient from "./client";

export interface AnalyticsScope {
  /** The run (a version id); the API takes the latest finished run when it is left out. */
  versionId?: string;
  /** One object (module id) only. */
  module?: string;
}

const params = ({ versionId, module }: AnalyticsScope = {}, extra: Record<string, string | number> = {}) => ({
  ...(versionId ? { version_id: versionId } : {}),
  ...(module ? { module } : {}),
  ...extra,
});

export interface BurndownDay {
  day: string;
  open: number;
  opened: number;
  closed: number;
}

export interface BurndownRun {
  version_id: string;
  label: string | null;
  run_at: string | null;
  /** Record checks failing in the run (findings.affected_count). */
  issues: number;
  /** Records still to work in the run's work list; null when the run has no work list. */
  open_records: number | null;
}

export interface Burndown {
  version_id: string | null;
  today: string;
  /** The last 90 UTC days, oldest first. */
  days: BurndownDay[];
  open_now: number;
  open_records: number | null;
  fixed_7d: number;
  /** Net issues closed per day over the last `pace_window_days`; zero or negative means no finish date. */
  pace_per_day: number;
  pace_window_days: number;
  projected_finish: string | null;
  runs: BurndownRun[];
}

export interface FixTime {
  fixed: number;
  median_days: number | null;
  p90_days: number | null;
}

export interface TimeToFix {
  window_days: number;
  overall: FixTime;
  by_object: (FixTime & { module: string })[];
  by_check: (FixTime & { check_id: string; module: string })[];
  by_severity: (FixTime & { severity: string })[];
}

export type DecisionKind = "accept" | "edit" | "not_an_issue" | "accept_risk" | "approve";

export interface PersonThroughput extends Record<DecisionKind, number> {
  person: string;
  total: number;
}

export interface Workload {
  assignee_id: string | null;
  name: string | null;
  email: string | null;
  open: number;
  critical: number;
  overdue: number;
}

export interface Throughput {
  window_days: number;
  days: { day: string; total: number; by_person: Record<string, number> }[];
  totals: Record<DecisionKind | "total", number>;
  people: PersonThroughput[];
  workload: Workload[];
}

export interface RecurrenceStat {
  issues: number;
  reopened: number;
  reopens: number;
  rate_pct: number;
}

export interface Recurrence {
  totals: RecurrenceStat;
  by_check: (RecurrenceStat & { check_id: string; module: string })[];
  by_system: (RecurrenceStat & { scope: string; name: string | null })[];
}

export interface RootCauseValue {
  value: string;
  records: number;
  issues: number;
  open: number;
  critical: number;
  share_pct: number;
}

export interface RootCauseDimension {
  /** The SAP key field: BUKRS, WERKS, VKORG, EKORG or LGORT. */
  field: string;
  label: string;
  records: number;
  values: number;
  top: RootCauseValue[];
}

export interface RootCauses {
  version_id: string | null;
  source: "work_records" | "finding_records" | null;
  total_records: number;
  dimensions: RootCauseDimension[];
}

export type ProposalSource = "rule" | "steward" | "cleaning" | "simulation" | "manual";

export interface ProposalSourceStat {
  source: ProposalSource | string;
  proposed: number;
  approved: number;
  exported: number;
  fixed: number;
  still_failing: number;
  approval_rate_pct: number | null;
  fix_rate_pct: number | null;
}

export interface ProposalQuality {
  sources: ProposalSourceStat[];
  totals: Pick<ProposalSourceStat, "proposed" | "approved" | "exported" | "fixed" | "still_failing">;
}

export interface RunChangeObject {
  module: string;
  new: number;
  fixed: number;
  still_failing: number;
  not_comparable_checks: number;
}

export interface RunChange {
  version_id: string | null;
  previous: { version_id: string; label: string | null; run_at: string | null } | null;
  objects: RunChangeObject[];
  totals: { new: number; fixed: number; still_failing: number };
  not_comparable_checks: number;
}

const base = "/api/v1/work/analytics";

export async function getBurndown(scope?: AnalyticsScope): Promise<Burndown> {
  return (await apiClient.get<Burndown>(`${base}/burndown`, { params: params(scope) })).data;
}

export async function getTimeToFix(scope?: AnalyticsScope, days = 180): Promise<TimeToFix> {
  return (await apiClient.get<TimeToFix>(`${base}/time-to-fix`, { params: params({ module: scope?.module }, { days }) })).data;
}

export async function getThroughput(scope?: AnalyticsScope): Promise<Throughput> {
  return (await apiClient.get<Throughput>(`${base}/throughput`, { params: params({ module: scope?.module }) })).data;
}

export async function getRecurrence(scope?: AnalyticsScope): Promise<Recurrence> {
  return (await apiClient.get<Recurrence>(`${base}/recurrence`, { params: params({ module: scope?.module }) })).data;
}

export async function getRootCauses(scope?: AnalyticsScope): Promise<RootCauses> {
  return (await apiClient.get<RootCauses>(`${base}/root-causes`, { params: params(scope) })).data;
}

export async function getProposalQuality(scope?: AnalyticsScope): Promise<ProposalQuality> {
  return (await apiClient.get<ProposalQuality>(`${base}/proposal-quality`, { params: params({ module: scope?.module }) })).data;
}

export async function getRunChange(scope?: AnalyticsScope): Promise<RunChange> {
  return (await apiClient.get<RunChange>(`${base}/run-change`, { params: params(scope) })).data;
}
