/**
 * Work analytics client: how fast the steward work list is being worked down (api/routes/work_analytics.py). Every
 * read takes `scope: "current"` where the route offers it, so the figures cover each object at its latest complete run.
 *
 *   GET /work/analytics/burndown          (open issues day by day, the pace and the projected finish)
 *   GET /work/analytics/run-change        (what the latest run found new, fixed and still failing, per object)
 *   GET /work/analytics/time-to-fix       (median and 90th percentile days from found to fixed)
 *   GET /work/analytics/throughput        (decisions per person over the last weeks, and open work per assignee)
 *   GET /work/analytics/recurrence        (issues that came back after they were closed)
 *   GET /work/analytics/root-causes       (the organisational units the failing records sit in)
 *   GET /work/analytics/proposal-quality  (how often each source's proposals are approved and actually fix the record)
 */
import { v2Get } from "./client";

const P = "/work/analytics";

export interface Burndown {
  version_id: string | null;
  today: string;
  days: { day: string; open: number; opened: number; closed: number }[];
  open_now: number;
  open_records: number | null;
  fixed_7d: number;
  pace_per_day: number;
  pace_window_days: number;
  projected_finish: string | null;
}

export interface FixStat {
  fixed: number;
  median_days: number | null;
  p90_days: number | null;
}

export interface TimeToFix {
  window_days: number;
  overall: FixStat;
  by_object: (FixStat & { module: string })[];
  by_check: (FixStat & { check_id: string; module: string })[];
  by_severity: (FixStat & { severity: string })[];
}

export interface Throughput {
  window_days: number;
  days: { day: string; total: number; by_person: Record<string, number> }[];
  people: { person: string; user_id: string | null; total: number; accept: number; edit: number; not_an_issue: number; accept_risk: number; approve: number }[];
  workload: { assignee_id: string; name: string | null; email: string | null; open: number; critical: number; overdue: number }[];
}

export interface Recurrence {
  totals: { issues: number; reopened: number; reopens: number; rate_pct: number };
  by_check: { check_id: string; module: string; issues: number; reopened: number; reopens: number; rate_pct: number }[];
  by_system: { scope: string; name: string | null; issues: number; reopened: number; reopens: number; rate_pct: number }[];
}

export interface RootCauses {
  source: string | null;
  total_records: number;
  dimensions: { field: string; label: string; records: number; values: number; top: { value: string; records: number; issues: number; open: number; critical: number; share_pct: number }[] }[];
}

export interface ProposalSource {
  source: string;
  proposed: number;
  approved: number;
  exported: number;
  fixed: number;
  still_failing: number;
  approval_rate_pct: number | null;
  fix_rate_pct: number | null;
}

export interface RunChange {
  objects: {
    module: string;
    new: number;
    fixed: number;
    still_failing: number;
    not_comparable_checks: number;
    rules: { newly_failing: { check_id: string; severity: string; new: number }[]; recovered: { check_id: string }[]; newly_failing_total: number; recovered_total: number };
  }[];
  totals: { new: number; fixed: number; still_failing: number };
  not_comparable_checks: number;
}

const cur = { scope: "current" };
export const getBurndown = () => v2Get<Burndown>(`${P}/burndown`, cur);
export const getRunChange = () => v2Get<RunChange>(`${P}/run-change`, cur);
export const getRootCauses = () => v2Get<RootCauses>(`${P}/root-causes`, cur);
export const getTimeToFix = (days = 180) => v2Get<TimeToFix>(`${P}/time-to-fix`, { days });
export const getThroughput = () => v2Get<Throughput>(`${P}/throughput`);
export const getRecurrence = () => v2Get<Recurrence>(`${P}/recurrence`);
export const getProposalQuality = () => v2Get<{ sources: ProposalSource[] }>(`${P}/proposal-quality`);
