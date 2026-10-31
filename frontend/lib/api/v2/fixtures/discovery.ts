/**
 * Process discovery fixture, shaped like api/routes/process_discovery.py. ECC production has the ten ABAP processes:
 * purchase to pay, order to cash and record to report are mined, production planning is mining now, master data
 * governance failed, the rest show the reference model. SuccessFactors, Ariba and Concur carry the route's reason.
 * Only purchase to pay has a drill-down below L2; its other L2s answer with no children, as an L4 does on the server.
 * Starting a run adds a queued run; schedules are kept in memory.
 */
import type { CatalogueEntry, CaseEvent, Conformance, Dfg, L1Health, NodeStats, RunSummary, Schedule, Variant } from "../discovery";

export const NONE_DISCOVERY = Symbol("not a process discovery path");

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const SF = "a1b2c3d4-0003-4000-8000-000000000003";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
const refuse = (status: number, detail: string): never => {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
};

const NAMES: Record<string, string> = {
  PTP: "Purchase to pay", OTC: "Order to cash", R2R: "Record to report", PP: "Plan to produce", PM: "Plant maintenance",
  QM: "Quality management", PS: "Project systems", WH: "Warehouse management", HTR: "Hire to retire", MDG: "Master data governance",
  SFX: "SuccessFactors recruiting", ARB: "Ariba sourcing to pay", CNQ: "Concur travel and expense",
};
const ABAP = ["PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG"];
const CLOUD_REASON: Record<string, string> = {
  SFX: "Connect the SuccessFactors / Ariba / Concur system to discover this process.",
  ARB: "Connect the SuccessFactors / Ariba / Concur system to discover this process.",
  CNQ: "Connect the SuccessFactors / Ariba / Concur system to discover this process.",
};

// l1, run id, hours since finished, cases, variants, median seconds, automation, fitness, previous fitness, DQ defects
const MINED: [string, string, number, number, number, number, number, number, number | null, number][] = [
  ["PTP", "pd-run-ptp", 9, 48_212, 1_284, 11.6 * DAY / 1000, 0.42, 0.81, 0.84, 3_118],
  ["OTC", "pd-run-otc", 9, 36_904, 742, 6.2 * DAY / 1000, 0.57, 0.88, 0.87, 1_402],
  ["R2R", "pd-run-r2r", 33, 212_480, 96, 0.8 * DAY / 1000, 0.91, 0.96, null, 214],
];
const SOURCES: Record<string, [string, number][]> = {
  PTP: [["EBAN", 61_402], ["EKKO", 52_118], ["EKPO", 148_930], ["EKBE", 402_117], ["RBKP", 49_880]],
  OTC: [["VBAK", 39_210], ["VBAP", 102_448], ["LIKP", 41_022], ["VBRK", 38_870]],
  R2R: [["BKPF", 214_002], ["BSEG", 1_208_441]],
};

let queued: RunSummary[] = [];
let schedules: Schedule[] = [];
let scheduleSeq = 0;

export const resetDiscoveryFixture = (): void => {
  queued = [];
  scheduleSeq = 0;
  schedules = [
    { id: "pd-sch-1", system_id: ECC, l1: "PTP", mode: "incremental", created_at: ago(60), schedule_cron: "0 2 * * *", active: true, last_run_at: ago(9), next_run_at: ago(-15) },
    { id: "pd-sch-2", system_id: ECC, l1: "OTC", mode: "incremental", created_at: ago(60), schedule_cron: "0 2 * * *", active: true, last_run_at: ago(9), next_run_at: ago(-15) },
    { id: "pd-sch-3", system_id: ECC, l1: "R2R", mode: "full", created_at: ago(60), schedule_cron: "0 3 * * 1", active: false, last_run_at: ago(33), next_run_at: null },
  ];
};
resetDiscoveryFixture();

const completed = (l1: string) => MINED.find((m) => m[0] === l1);

function catalogue(systemId: string): CatalogueEntry[] {
  const minable = systemId === ECC ? ABAP : systemId === SF ? ["SFX"] : [];
  return Object.keys(NAMES).map((l1) => {
    const m = completed(l1);
    const q = queued.find((r) => r.l1 === l1);
    const mining = q ?? (l1 === "PP" ? { id: "pd-run-pp", status: "mining" as const } : null);
    return {
      l1,
      name: NAMES[l1],
      coverage: m ? "observed" : "reference",
      reason: minable.includes(l1) ? null : CLOUD_REASON[l1] ?? "Discovered from an ABAP system.",
      last_run: m ? { id: m[1], status: "completed", finished_at: ago(m[2]), cases: m[3], variants: m[4], median_seconds: m[5], automation_rate: m[6], fitness: m[7] } : null,
      in_progress: mining && minable.includes(l1) ? { id: mining.id, status: mining.status, job_id: `job-${mining.id}`, error: null } : null,
      failed: l1 === "MDG" && minable.includes(l1) ? { id: "pd-run-mdg", status: "failed", job_id: "job-pd-run-mdg", error: "Table USMD120C is not readable with this connection's authorisations." } : null,
      dq_defects: m ? m[9] : null,
      dq_version_id: m ? "v-2026-10-30" : null,
      licence_blocked: false,
      sources: (SOURCES[l1] ?? []).map(([table, rows]) => ({ table, rows, partial: false })),
    };
  });
}

function health(systemId: string): L1Health[] {
  if (systemId !== ECC) return [];
  return ABAP.map((l1) => {
    const m = completed(l1);
    const s = schedules.find((x) => x.l1 === l1);
    const freshness = l1 === "MDG" ? "failed" : !m ? "manual" : s && !s.active ? "paused" : m[2] > 24 ? "due" : "fresh";
    return {
      l1,
      last_run: m ? { id: m[1], status: "completed", finished_at: ago(m[2]), fitness: m[7] } : null,
      previous_fitness: m ? m[8] : null,
      fitness_drift: m && m[8] !== null ? Math.round((m[7] - m[8]) * 1000) / 1000 : null,
      schedule: s ? { id: s.id, cron: s.schedule_cron, active: s.active, next_run_at: s.next_run_at } : null,
      freshness,
    };
  });
}

function runs(systemId: string, l1: string | undefined): RunSummary[] {
  if (systemId !== ECC) return [];
  const done: RunSummary[] = MINED.map(([l, id, h]) => ({
    id, l1: l, mode: "incremental", status: "completed", coverage: "observed",
    window_from: "2025-11-01", window_to: "2026-10-30", error: null, started_at: ago(h + 1), finished_at: ago(h),
  }));
  return [...queued, ...done].filter((r) => !l1 || r.l1 === l1);
}

// PTP tree: node id, name, case count, median days, fitness, DQ defects, observed
type N = [string, string, number, number | null, number | null, number | null, boolean];
const TREE: Record<string, N[]> = {
  "PTP": [
    ["PTP.1", "Requisition", 41_870, 1.2, 0.86, 640, true],
    ["PTP.2", "Purchase order", 48_212, 0.9, 0.82, 1_210, true],
    ["PTP.3", "Goods receipt", 45_118, 6.4, 0.79, 402, true],
    ["PTP.4", "Invoice verification", 44_902, 2.1, 0.74, 866, true],
    ["PTP.5", "Payment", 43_560, 1.0, 0.93, 0, true],
    ["PTP.6", "Contract release", 0, null, null, null, false],
  ],
  "PTP.2": [
    ["PTP.2.1", "Create purchase order", 48_212, 0.1, 0.97, 210, true],
    ["PTP.2.2", "Change purchase order", 17_402, 0.6, 0.71, 380, true],
    ["PTP.2.3", "Release purchase order", 29_110, 0.4, 0.88, 0, true],
    ["PTP.2.4", "Send to vendor", 46_004, 0.1, 0.95, 620, true],
  ],
};
const EDGES: Record<string, [string, string, number, number][]> = {
  "PTP": [["PTP.1", "PTP.2", 40_210, 1.2], ["PTP.2", "PTP.3", 44_870, 6.4], ["PTP.3", "PTP.4", 43_920, 2.1], ["PTP.4", "PTP.5", 43_118, 1.0], ["PTP.2", "PTP.4", 1_204, 3.3]],
  "PTP.2": [["PTP.2.1", "PTP.2.3", 28_840, 0.4], ["PTP.2.1", "PTP.2.4", 18_410, 0.1], ["PTP.2.3", "PTP.2.4", 27_502, 0.1], ["PTP.2.4", "PTP.2.2", 15_022, 2.6], ["PTP.2.2", "PTP.2.4", 13_900, 0.3]],
};
const L1_CASES: Record<string, number> = { "pd-run-ptp": 48_212, "pd-run-otc": 36_904, "pd-run-r2r": 212_480 };
const RUN_L1: Record<string, string> = { "pd-run-ptp": "PTP", "pd-run-otc": "OTC", "pd-run-r2r": "R2R" };

const stats = ([id, name, cases, days, fitness, dq, observed]: N, total: number): NodeStats => ({
  id, name, source: observed ? "observed" : "reference", observed, case_count: cases, share: total ? Math.round((cases / total) * 1000) / 1000 : 0,
  median_seconds: days === null ? null : Math.round(days * DAY / 1000), fitness, dq_defects: dq,
});

function findNode(id: string, total: number): NodeStats | null {
  for (const rows of Object.values(TREE)) {
    const hit = rows.find((r) => r[0] === id);
    if (hit) return stats(hit, total);
  }
  return null;
}

function dfg(runId: string, nodeId: string | null): Dfg {
  const l1 = RUN_L1[runId] ?? refuse(404, "Run not found");
  const total = L1_CASES[runId];
  const id = nodeId ?? l1;
  const node = id === l1 ? stats([l1, NAMES[l1], total, null, completed(l1)?.[7] ?? null, completed(l1)?.[9] ?? null, true], total) : findNode(id, total) ?? refuse(404, "Process node not found");
  const level = id.split(".").length + 1;
  return {
    level,
    node,
    nodes: (TREE[id] ?? []).map((r) => stats(r, total)),
    edges: (EDGES[id] ?? []).map(([source, target, count, days]) => ({ source, target, count, median_seconds: Math.round(days * DAY / 1000) })),
  };
}

const VARIANTS: [string[], number, number, number, number][] = [
  [["Create requisition", "Create purchase order", "Release purchase order", "Send to vendor", "Goods receipt", "Invoice receipt", "Payment"], 18_204, 9.8, 21.0, 1],
  [["Create purchase order", "Send to vendor", "Goods receipt", "Invoice receipt", "Payment"], 9_870, 8.1, 17.5, 0.86],
  [["Create requisition", "Create purchase order", "Release purchase order", "Send to vendor", "Change purchase order", "Send to vendor", "Goods receipt", "Invoice receipt", "Payment"], 6_402, 14.2, 33.0, 0.78],
  [["Create requisition", "Create purchase order", "Send to vendor", "Invoice receipt", "Goods receipt", "Payment"], 3_118, 12.7, 29.4, 0.71],
  [["Create purchase order", "Send to vendor", "Invoice receipt", "Payment"], 1_204, 4.4, 11.2, 0.57],
];
const variants = (runId: string): { case_type: string; total: number; items: Variant[] } => {
  if (runId !== "pd-run-ptp") return { case_type: "po_item", total: 0, items: [] };
  return {
    case_type: "po_item",
    total: 1_284,
    items: VARIANTS.map(([activities, n, med, p90, fit], i) => ({
      hash: `v${i + 1}a7c${i}`, activities, case_count: n, share: Math.round((n / 48_212) * 1000) / 1000,
      median_seconds: Math.round(med * DAY / 1000), p90_seconds: Math.round(p90 * DAY / 1000), fitness: fit,
    })),
  };
};

const CONFORMANCE: Conformance = {
  case_type: "po_item",
  fitness: 0.81,
  missing: { "Goods receipt": 0.064, "Release purchase order": 0.396, "Create requisition": 0.132 },
  steps: [
    { activity: "Create requisition", step_fitness: 0.87, out_of_order: 0 },
    { activity: "Create purchase order", step_fitness: 1, out_of_order: 0 },
    { activity: "Release purchase order", step_fitness: 0.6, out_of_order: 212 },
    { activity: "Send to vendor", step_fitness: 0.95, out_of_order: 0 },
    { activity: "Goods receipt", step_fitness: 0.94, out_of_order: 3_118 },
    { activity: "Invoice receipt", step_fitness: 0.93, out_of_order: 4_322 },
    { activity: "Payment", step_fitness: 0.9, out_of_order: 0 },
  ],
  extra: [{ activity: "Change purchase order", cases: 17_402, share: 0.361 }, { activity: "Reverse goods receipt", cases: 1_088, share: 0.023 }],
  happy_path: { activities: VARIANTS[0][0], case_count: 18_204, share: 0.378, fitness: 1 },
};

const CASES = [
  ["4500018231/00010", "2026-09-02T08:14:00Z", "2026-09-11T15:40:00Z", 7, "v1a7c0"],
  ["4500018244/00010", "2026-09-02T09:02:00Z", "2026-09-19T10:12:00Z", 9, "v3a7c2"],
  ["4500018260/00020", "2026-09-03T11:31:00Z", "2026-09-10T08:55:00Z", 5, "v2a7c1"],
  ["4500018302/00010", "2026-09-04T07:48:00Z", "2026-09-16T13:20:00Z", 6, "v4a7c3"],
  ["4500018317/00010", "2026-09-04T14:05:00Z", "2026-09-08T09:30:00Z", 4, "v5a7c4"],
] as const;
const cases = (runId: string, variant: string | undefined) => {
  const items = runId === "pd-run-ptp" ? CASES.filter((c) => !variant || c[4] === variant).map(([case_id, first_ts, last_ts, events, v]) => ({ case_id, first_ts, last_ts, events, variant: v })) : [];
  return { case_type: "po_item", total: items.length, items };
};
function caseEvents(runId: string, caseId: string): { case_type: string; case_id: string; events: CaseEvent[] } {
  const c = runId === "pd-run-ptp" ? CASES.find((x) => x[0] === caseId) : undefined;
  if (!c) return refuse(404, "Case not found");
  const v = VARIANTS.find((_, i) => `v${i + 1}a7c${i}` === c[4]) ?? VARIANTS[0];
  const start = Date.parse(c[1]);
  const span = (Date.parse(c[2]) - start) / Math.max(1, v[0].length - 1);
  const table: Record<string, string> = { "Create requisition": "EBAN", "Goods receipt": "EKBE", "Invoice receipt": "RBKP", Payment: "BSAK" };
  return {
    case_type: "po_item",
    case_id: caseId,
    events: v[0].map((activity, seq) => ({
      activity, ts: new Date(start + seq * span).toISOString(), seq, resource: seq % 3 === 0 ? "BATCH_USER" : "TMOKOENA",
      automated: seq % 3 === 0, doc_type: activity.includes("order") ? "NB" : null, source_table: table[activity] ?? "EKKO",
    })),
  };
}

const params = (path: string): [string, URLSearchParams] => {
  const [p, q = ""] = path.split("?");
  return [p, new URLSearchParams(q)];
};

export function discoveryRead(path: string, query: Record<string, unknown> = {}): unknown {
  const [p, qs] = params(path);
  if (!p.startsWith("/process-discovery/")) return NONE_DISCOVERY;
  const get = (k: string) => (query[k] ?? qs.get(k) ?? undefined) as string | undefined;
  let m = /^\/process-discovery\/systems\/([^/]+)\/(catalogue|health|runs|schedules)$/.exec(p);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (m[2] === "catalogue") return catalogue(id);
    if (m[2] === "health") return health(id);
    if (m[2] === "runs") return runs(id, get("l1"));
    return id === ECC ? schedules : [];
  }
  m = /^\/process-discovery\/runs\/([^/]+)\/(dfg|variants|conformance|cases)(?:\/(.+))?$/.exec(p);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (m[2] === "dfg") return dfg(id, get("node_id") ?? null);
    if (m[2] === "variants") return variants(id);
    if (m[2] === "conformance") return id === "pd-run-ptp" ? CONFORMANCE : refuse(404, "No conformance for this run");
    if (m[3]) return caseEvents(id, decodeURIComponent(m[3]));
    return cases(id, get("variant"));
  }
  return NONE_DISCOVERY;
}

export function discoveryWrite(method: string, path: string, body: unknown): unknown {
  const [p] = params(path);
  if (!p.startsWith("/process-discovery/")) return NONE_DISCOVERY;
  const b = (body ?? {}) as Record<string, unknown>;
  let m = /^\/process-discovery\/systems\/([^/]+)\/runs$/.exec(p);
  if (m && method === "POST") {
    const l1s = (b.l1s as string[] | undefined) ?? [];
    if (!l1s.length) return refuse(422, "Choose at least one process");
    const bad = l1s.find((l) => !ABAP.includes(l));
    if (bad) return refuse(400, `${bad} cannot be discovered on this system.`);
    const run_ids = l1s.map((l1) => {
      const id = `pd-run-new-${l1.toLowerCase()}-${queued.length + 1}`;
      queued = [{ id, l1, mode: (b.mode as "full" | "incremental") ?? "incremental", status: "queued", coverage: "reference", window_from: null, window_to: null, error: null, started_at: new Date().toISOString(), finished_at: null }, ...queued];
      return id;
    });
    return { job_id: `job-pd-${queued.length}`, run_ids };
  }
  m = /^\/process-discovery\/systems\/([^/]+)\/schedules(?:\/([^/]+))?$/.exec(p);
  if (!m) return NONE_DISCOVERY;
  const sid = m[2] ? decodeURIComponent(m[2]) : null;
  if (method === "POST" && !sid) {
    const l1 = String(b.l1 ?? "");
    if (schedules.some((s) => s.l1 === l1)) return refuse(409, "This process already has a schedule.");
    const s: Schedule = { id: `pd-sch-new-${++scheduleSeq}`, system_id: ECC, l1, mode: "incremental", created_at: ago(0), schedule_cron: String(b.schedule_cron ?? ""), active: b.active !== false, last_run_at: null, next_run_at: ago(-24) };
    schedules = [...schedules, s];
    return s;
  }
  const s = schedules.find((x) => x.id === sid) ?? refuse(404, "Schedule not found");
  if (method === "DELETE") {
    schedules = schedules.filter((x) => x.id !== sid);
    return undefined;
  }
  const next: Schedule = { ...s, ...(b.schedule_cron !== undefined ? { schedule_cron: String(b.schedule_cron) } : {}), ...(b.active !== undefined ? { active: Boolean(b.active) } : {}) };
  next.next_run_at = next.active ? ago(-24) : null;
  schedules = schedules.map((x) => (x.id === sid ? next : x));
  return next;
}

export function discoveryDownload(path: string): { name: string; text: string } | null {
  const m = /^\/process-discovery\/runs\/([^/]+)\/export\/(signavio|bpmn)(?:\/(.+))?$/.exec(path);
  if (!m) return null;
  return m[2] === "signavio"
    ? { name: `process-${m[1]}.json`, text: "Fixture stand-in for the Signavio export of this run." }
    : { name: `process-${m[3]}.bpmn`, text: "Fixture stand-in for the BPMN export of this process." };
}
