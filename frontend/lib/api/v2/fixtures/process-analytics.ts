/**
 * Process analytics fixture, shaped like api/routes/process_analytics.py. The counts are synthetic and consistent:
 * the per-object rows add up to the totals, and the bottleneck is the step with the longest median dwell.
 */
import type { ApprovalForecast, ForecastEvidence, ObjectRow, ProcessAnalytics } from "../process-analytics";

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

const ev = (id: string, title: string, dwell_hours: number, decided_at: string): ForecastEvidence => ({ request_id: id, title, dwell_hours, decided_at });

/**
 * Forecast at the requests fixture's clock (2026-10-20T08:00Z). Each row's P50 and P90 are nearest-rank over its
 * evidence (the decided tasks that waited longer than this one has), and its breach share is the evidence over its SLA.
 */
const FORECAST: ApprovalForecast = {
  open: 4, without_pending: 1, at_risk: 2, breached: 1,
  requests: [
    {
      request_id: "CR-0997", title: "New supplier: freight forwarder", object: "vendor", kind: "create", status: "in_approval", object_key: null,
      step: "Procurement approval", step_index: 1, activated_at: "2026-10-14T10:00:00Z", due_at: "2026-10-17T10:00:00Z", sla_hours: 72,
      elapsed_hours: 142, basis: "step", conditioned: true, n: 3, p50_hours: 190, p90_hours: 260,
      eta: "2026-10-22T08:00:00Z", p90_eta: "2026-10-25T06:00:00Z", breach_probability: 1, breached: true, remaining: [], request_eta: "2026-10-22T08:00:00Z",
      evidence: [ev("CR-0951", "New supplier: packaging", 150, "2026-10-02T11:00:00Z"), ev("CR-0937", "Bank details for a supplier", 190, "2026-09-21T16:00:00Z"), ev("CR-0902", "New supplier: site services", 260, "2026-08-30T09:30:00Z")],
    },
    {
      request_id: "CR-0999", title: "Payment terms for a customer", object: "customer", kind: "change", status: "in_approval", object_key: "KUNNR=0000204780",
      step: "Data steward review", step_index: 0, activated_at: "2026-10-19T14:00:00Z", due_at: "2026-10-20T14:00:00Z", sla_hours: 24,
      elapsed_hours: 18, basis: "object_kind_step", conditioned: true, n: 4, p50_hours: 22, p90_hours: 41,
      eta: "2026-10-20T12:00:00Z", p90_eta: "2026-10-21T07:00:00Z", breach_probability: 0.5, breached: false,
      remaining: [{ step: "Finance approval", index: 1, basis: "object_kind_step", n: 12, p50_hours: 26.75, sla_hours: 48 }], request_eta: "2026-10-21T14:45:00Z",
      evidence: [ev("CR-0988", "Credit limit for a customer", 19.5, "2026-10-16T10:30:00Z"), ev("CR-0979", "Payment terms for a customer", 22, "2026-10-09T08:00:00Z"), ev("CR-0966", "Dunning procedure change", 30, "2026-10-01T15:00:00Z"), ev("CR-0948", "Payment terms for a customer", 41, "2026-09-18T12:00:00Z")],
    },
    {
      request_id: "CR-1001", title: "New spare part: hydraulic seal kit", object: "material", kind: "create", status: "in_approval", object_key: null,
      step: "Four-eyes approval", step_index: 0, activated_at: "2026-10-18T09:05:00Z", due_at: "2026-10-22T09:05:00Z", sla_hours: 96,
      elapsed_hours: 46.92, basis: "object_kind_step", conditioned: true, n: 6, p50_hours: 70.5, p90_hours: 130,
      eta: "2026-10-21T07:35:00Z", p90_eta: "2026-10-23T19:05:00Z", breach_probability: 0.3333, breached: false,
      remaining: [{ step: "Finance sign-off", index: 1, basis: "step", n: 82, p50_hours: 26.75, sla_hours: 48 }], request_eta: "2026-10-22T10:20:00Z",
      evidence: [
        ev("CR-0994", "New spare part: filter element", 52, "2026-10-14T13:00:00Z"), ev("CR-0985", "New spare part: idler roller", 61, "2026-10-08T17:00:00Z"),
        ev("CR-0971", "New raw material: grease", 70.5, "2026-10-02T09:30:00Z"), ev("CR-0960", "New spare part: wear plate", 88, "2026-09-25T14:00:00Z"),
        ev("CR-0943", "New spare part: pump seal", 101, "2026-09-15T10:00:00Z"), ev("CR-0920", "New spare part: track link", 130, "2026-09-04T16:00:00Z"),
      ],
    },
  ],
};

export function processAnalyticsRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/governance/approval-forecast") return FORECAST satisfies ApprovalForecast;
  if (path !== "/governance/process-analytics") return NONE_PROCESS_ANALYTICS;
  const days = Number(params.days ?? 90) || 90;
  const obj = params.object ? String(params.object) : "";
  const objects = obj ? OBJECTS.filter((o) => o.object === obj) : OBJECTS;
  return { ...BASE, days, objects, total: objects.reduce((n, o) => n + o.total, 0) } satisfies ProcessAnalytics;
}
