/**
 * Process analytics fixture, shaped like api/routes/process_analytics.py. The counts are synthetic and consistent:
 * the per-object rows add up to the totals, and the bottleneck is the step with the longest median dwell.
 */
import type { ObjectRow, ProcessAnalytics } from "../process-analytics";

export const NONE_PROCESS_ANALYTICS = Symbol("not a process analytics path");

const OBJECTS: ObjectRow[] = [
  { object: "material", total: 64, open: 9, created: 46, rejected: 6, failed: 1, cancelled: 2, median_cycle_hours: 52.5, p90_cycle_hours: 141 },
  { object: "customer", total: 31, open: 4, created: 23, rejected: 3, failed: 0, cancelled: 1, median_cycle_hours: 30.25, p90_cycle_hours: 96 },
  { object: "vendor", total: 22, open: 5, created: 14, rejected: 2, failed: 1, cancelled: 0, median_cycle_hours: 61, p90_cycle_hours: 170.5 },
  { object: "business_partner", total: 9, open: 1, created: 7, rejected: 1, failed: 0, cancelled: 0, median_cycle_hours: 22, p90_cycle_hours: 48 },
];

const WEEKLY = [
  ["2026-08-17", 8, 5], ["2026-08-24", 11, 7], ["2026-08-31", 9, 9], ["2026-09-07", 12, 8], ["2026-09-14", 10, 11],
  ["2026-09-21", 14, 9], ["2026-09-28", 9, 10], ["2026-10-05", 13, 12], ["2026-10-12", 11, 9], ["2026-10-19", 10, 11],
  ["2026-10-26", 8, 7], ["2026-11-02", 7, 6],
] as const;

const BASE: Omit<ProcessAnalytics, "days" | "objects" | "total"> = {
  by_status: { approved: 3, cancelled: 3, created: 90, creating: 1, failed: 2, in_approval: 11, rejected: 12, submitted: 4 },
  cycle: { n: 90, median_hours: 46, p90_hours: 140 },
  approval: { n: 105, median_hours: 31.5, p90_hours: 118 },
  rates: { closed: 107, rejection: 0.1121, failure: 0.0187, cancellation: 0.028 },
  sla: { with_sla: 238, breached: 29, rate: 0.1218 },
  steps: [
    { step: "Data steward review", index: 0, tasks: 126, decided: 119, pending: 7, breached: 6, overdue_open: 2, median_dwell_hours: 5.5, p90_dwell_hours: 20 },
    { step: "Finance approval", index: 1, tasks: 82, decided: 73, pending: 9, breached: 21, overdue_open: 5, median_dwell_hours: 26.75, p90_dwell_hours: 97 },
    { step: "Procurement approval", index: 1, tasks: 30, decided: 28, pending: 2, breached: 2, overdue_open: 0, median_dwell_hours: 9, p90_dwell_hours: 31 },
  ],
  bottleneck: "Finance approval",
  aging: { lt_1d: 5, d1_3: 6, d3_7: 5, gt_7d: 3 },
  weekly: WEEKLY.map(([week, submitted, created]) => ({ week, submitted, created })),
};

export function processAnalyticsRead(path: string, params: Record<string, unknown>): unknown {
  if (path !== "/governance/process-analytics") return NONE_PROCESS_ANALYTICS;
  const days = Number(params.days ?? 90) || 90;
  const obj = params.object ? String(params.object) : "";
  const objects = obj ? OBJECTS.filter((o) => o.object === obj) : OBJECTS;
  return { ...BASE, days, objects, total: objects.reduce((n, o) => n + o.total, 0) } satisfies ProcessAnalytics;
}
