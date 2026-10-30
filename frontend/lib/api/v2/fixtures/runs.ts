/**
 * Fixture answers for step 3: the run timeline, compare, versions, jobs and the system reads. Built from the same
 * prototype numbers as the landscape fixture: eight weekly runs of ECC production, the 2 Oct run pinned as baseline,
 * the 16 Oct run current. Between those two the per-object scores are the prototype's, so the compare totals reconcile
 * with its rows (14 newly failing, 37 fixed, 23 worse, 61 better); the other runs interpolate. Counts and lists come
 * from one generator, so GET /runs/{a}/vs/{b}/summary and GET /versions/compare always agree, as the backend's do.
 *
 * `?job=running` adds one running extraction, for the job line.
 */
import landscapeJson from "./landscape.json";
import runsJson from "./runs.json";
import { fixtureParam } from "../fixture";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell } from "../types";
import type { ChangeKind, CheckChange, CompareObject, CompareSide, CompareSummary, TimelineRun, VersionCompare, VersionHead } from "../runs";
import type { Job, JobStage, JobTable } from "@/types/jobs";
import type { SAPSystemExtended, SyncProfile } from "@/types/api";
import type { SystemObject, SystemVersion } from "@/lib/api/system-objects";
import type { ConfigLoad } from "@/lib/api/config-load";

const L = landscapeJson as unknown as Landscape;
const RUNS = (runsJson as unknown as { versions: { id: string; run_at: string; run_number: number }[] }).versions; // newest first
const ECC = L.systems[0];
const S4 = L.systems[1];
const SF = L.systems[2];

export const NONE = Symbol("no-runs-fixture");
type Params = Record<string, string | number | boolean | undefined>;

class FixtureNotFound extends Error {
  status = 404;
  constructor(path: string) {
    super(`No fixture for ${path}`);
  }
}

// ── State a fixture session can change: the pinned baseline and which runs are archived ──────────

const BASELINE_DEFAULT = RUNS[2].id; // 2 Oct
const state: { baseline: string | null; archived: Set<string>; retried: Set<string>; tested: Record<string, boolean>; started: Job[] } = { baseline: BASELINE_DEFAULT, archived: new Set(), retried: new Set(), tested: {}, started: [] };

/** Puts the fixture session back as it started: tests call this between cases. */
export function resetRunsFixture(): void {
  state.baseline = BASELINE_DEFAULT;
  state.archived = new Set();
  state.retried = new Set();
  state.tested = {};
  state.started = [];
}

// ── Per-object history ───────────────────────────────────────────────────────────────────────

/** [measured on 2 Oct, measured on 16 Oct, newly failing, fixed, worse, better] from the prototype's compare. */
const CMP: Record<string, [number, number, number, number, number, number]> = {
  material_master: [69.8, 71.8, 3, 9, 3, 20],
  business_partner: [77.6, 78.4, 1, 3, 1, 5],
  vendor_master: [77.3, 76.9, 3, 1, 5, 2],
  customer_master: [72.8, 74.2, 1, 4, 2, 6],
  gl_accounts: [92.9, 93.4, 0, 2, 0, 3],
  asset_accounting: [73.4, 72.6, 2, 1, 4, 1],
  controlling: [77.9, 79.1, 1, 3, 1, 4],
  purchasing: [74.4, 75.3, 0, 3, 1, 4],
  sales_orders: [79.2, 81.0, 1, 5, 2, 8],
  plant_maintenance: [74.1, 73.5, 2, 0, 3, 1],
  production_planning: [76.2, 77.7, 0, 2, 1, 3],
  project_system: [87.5, 88.6, 0, 1, 0, 1],
  quality_management: [90.4, 91.2, 0, 1, 0, 1],
  hcm: [79.8, 80.4, 0, 1, 0, 1],
  sd_customer_master: [77.5, 78.2, 0, 1, 0, 1],
};
const MODULES = L.objects.map((o) => o.module);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Index in RUNS (0 newest) to the run number 1 to 8, oldest first. */
const numberOf = (id: string): number => {
  const i = RUNS.findIndex((r) => r.id === id);
  return i < 0 ? 8 : RUNS.length - i;
};

function cellOf(module: string): LandscapeCell {
  return L.cells.find((c) => c.module === module) as LandscapeCell;
}

function measuredAt(module: string, k: number): number {
  const [before, after] = CMP[module];
  const idx = MODULES.indexOf(module);
  if (k >= 6) return r1(before + ((after - before) * (k - 6)) / 2);
  const wobble = (((k * 7 + idx) % 3) - 1) * 0.2;
  return r1(before - (6 - k) * 0.4 + wobble);
}

function shownAt(module: string, k: number): { score: number; capped: boolean } {
  const raw = measuredAt(module, k);
  const cell = cellOf(module);
  const cap = cell.capped ? (cell.cap_level ?? 70) : null;
  return cap !== null && raw > cap ? { score: cap, capped: true } : { score: raw, capped: false };
}

function recordsAt(module: string, k: number): number {
  const idx = MODULES.indexOf(module);
  const base = cellOf(module).records_checked ?? 0;
  return Math.round(base * (1 - (0.004 * (1 + (idx % 3)) * (8 - k)) / 2));
}

/** Rules added since each run: 11 at the baseline, 5 at the run before the latest, none in the latest. */
function rulesAt(module: string, k: number): number {
  const idx = MODULES.indexOf(module);
  const added = k >= 8 ? 0 : k === 7 ? 5 : 11;
  return (cellOf(module).rules_measured ?? 0) - (idx < added ? 1 : 0);
}

const KINDS = ["scheduled", "scheduled", "manual", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"];
const DURATIONS = [655, 690, 701, 668, 712, 694, 688, 702];

function timelineRun(k: number): TimelineRun {
  const run = RUNS[RUNS.length - k];
  const objects: TimelineRun["objects"] = {};
  let records = 0;
  for (const m of MODULES) {
    const s = shownAt(m, k);
    objects[m] = { score: s.score, raw_score: measuredAt(m, k), capped: s.capped };
    records += recordsAt(m, k);
  }
  return { id: run.id, run_at: run.run_at, label: null, system_id: ECC.id, baseline: state.baseline === run.id, kind: KINDS[k - 1], objects, records_checked: records, duration_s: DURATIONS[k - 1] };
}

const visibleRuns = (): number[] => [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => !state.archived.has(RUNS[RUNS.length - k].id));

export function fixtureTimeline(systemId: string | undefined, limit: number): { system_id: string | null; limit: number; runs: TimelineRun[] } {
  if (systemId && systemId !== ECC.id) return { system_id: systemId, limit, runs: [] };
  const ks = visibleRuns().slice(-limit);
  return { system_id: systemId ?? null, limit, runs: ks.map(timelineRun) };
}

function head(k: number): VersionHead {
  const run = RUNS[RUNS.length - k];
  const summary: NonNullable<VersionHead["dqs_summary"]> = {};
  for (const m of MODULES) {
    const s = shownAt(m, k);
    summary[m] = { total_checks: rulesAt(m, k), composite_score: s.score, raw_score: measuredAt(m, k), capped: s.capped };
  }
  return {
    id: run.id,
    run_at: run.run_at,
    label: null,
    run_number: k,
    parent_version_id: k > 1 ? RUNS[RUNS.length - k + 1].id : null,
    status: "complete",
    dqs_summary: summary,
    metadata: { system_id: ECC.id, trigger: KINDS[k - 1], baseline: state.baseline === run.id, archived: state.archived.has(run.id), modules: MODULES },
    severity_counts: { critical: 70 - (8 - k) * 2, high: 412 - (8 - k) * 9, medium: 1210, low: 904 },
  };
}

function failedHead(): VersionHead {
  return {
    id: FAILED_RUN,
    run_at: "2026-10-12T05:10:00Z",
    label: null,
    run_number: null,
    parent_version_id: null,
    status: "failed",
    dqs_summary: null,
    metadata: { system_id: S4.id, trigger: "manual", baseline: false, archived: state.archived.has(FAILED_RUN) },
    severity_counts: null,
  };
}
const FAILED_RUN = "f0000000-0000-4000-8000-0000000000f1";

function versionsPage(params: Params) {
  const includeArchived = params.include_archived === true || params.include_archived === "true";
  const ks = [8, 7, 6, 5, 4, 3, 2, 1].filter((k) => includeArchived || !state.archived.has(RUNS[RUNS.length - k].id));
  let rows = ks.map(head);
  const failedShown = includeArchived || !state.archived.has(FAILED_RUN);
  if (params.status === "failed") rows = failedShown ? [failedHead()] : [];
  else if (failedShown && (!params.system_id || params.system_id === S4.id)) rows = [...rows, failedHead()].sort((a, b) => b.run_at.localeCompare(a.run_at));
  if (params.system_id && params.system_id !== ECC.id && params.system_id !== S4.id) rows = [];
  else if (params.system_id === ECC.id) rows = rows.filter((r) => r.metadata?.system_id === ECC.id);
  else if (params.system_id === S4.id) rows = rows.filter((r) => r.metadata?.system_id === S4.id);
  const limit = Number(params.limit ?? 20);
  return { versions: rows.slice(0, limit), total: rows.length };
}

// ── Compare ──────────────────────────────────────────────────────────────────────────────────

function side(module: string, k: number): CompareSide {
  const s = shownAt(module, k);
  return { score: s.score, raw_score: measuredAt(module, k), capped: s.capped, records_checked: recordsAt(module, k), coverage: cellOf(module).coverage };
}

function countsFor(module: string, ka: number, kb: number): Record<ChangeKind, number> {
  const [, , nf, fx, w, b] = CMP[module];
  if (ka === kb) return { newly_failing: 0, fixed: 0, worse: 0, better: 0 };
  const sc = ka === 6 && kb === 8 ? 1 : Math.abs(kb - ka) / 2;
  const f = (n: number) => (ka === 6 && kb === 8 ? n : Math.round(n * sc));
  return { newly_failing: f(nf), fixed: f(fx), worse: f(w), better: f(b) };
}

const PREFIX: Record<string, string> = { material_master: "MM", business_partner: "BP", vendor_master: "VM", customer_master: "CM", gl_accounts: "GL", asset_accounting: "AA", controlling: "CO", purchasing: "PU", sales_orders: "SO", plant_maintenance: "PM", production_planning: "PP", project_system: "PS", quality_management: "QM", hcm: "HC", sd_customer_master: "SD" };
const FIELDS: Record<string, string[]> = {
  material_master: ["Base unit of measure", "Gross weight", "Net weight", "Valuation class", "Material group", "Purchasing group"],
  business_partner: ["Tax number format", "Street address", "Bank key", "Search term"],
  vendor_master: ["Payment terms", "Reconciliation account", "Bank details", "Order currency"],
  customer_master: ["Dunning procedure", "Payment terms", "Sales district", "Credit limit"],
  gl_accounts: ["Account group", "Field status group", "Tax category"],
  asset_accounting: ["Asset class", "Capitalisation date", "Depreciation key", "Cost centre"],
  controlling: ["Cost centre category", "Profit centre", "Responsible person"],
  purchasing: ["Purchasing group", "Incoterms", "Info record price", "Delivery tolerance"],
  sales_orders: ["Incoterms location", "Payment terms", "Delivery plant", "Shipping condition"],
  plant_maintenance: ["Equipment catalogue profile", "Maintenance plant", "Planner group"],
  production_planning: ["Routing", "Work centre", "Production version"],
  project_system: ["WBS element", "Project profile", "Responsible cost centre"],
  quality_management: ["Inspection type", "Control key", "Sampling procedure"],
  hcm: ["Cost centre assignment", "Pay scale group", "Bank details"],
  sd_customer_master: ["Pricing procedure", "Shipping condition", "Tax classification"],
};
const ISSUES = ["missing", "not valid", "not in the check table"];

/** The prototype's named rules, placed first in their object's list for each kind. */
const NAMED: Record<ChangeKind, [string, string][]> = {
  newly_failing: [["VM022", "Payment terms not in T052"], ["AA018", "Asset class without depreciation area"], ["PM011", "Equipment without catalogue profile"], ["MM119", "Net weight above gross weight"]],
  fixed: [["MM022", "Material group missing"], ["MM091", "Valuation class missing"], ["SO014", "Incoterms location missing"], ["CM009", "Dunning procedure not valid"]],
  worse: [["VM019", "Payment terms not valid"], ["MM057", "Gross weight missing"], ["AA009", "Capitalisation date missing"], ["PM014", "Maintenance plant missing"]],
  better: [["MM063", "Purchasing group missing"], ["SO021", "Payment terms not valid"], ["BP011", "Tax number format not valid"], ["CO015", "Cost centre category not valid"]],
};
const KIND_ORDER: ChangeKind[] = ["newly_failing", "fixed", "worse", "better"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function changesFor(ka: number, kb: number): Record<ChangeKind, CheckChange[]> {
  const out: Record<ChangeKind, CheckChange[]> = { newly_failing: [], fixed: [], worse: [], better: [] };
  for (const kind of KIND_ORDER) {
    let seq = 200 + KIND_ORDER.indexOf(kind) * 100;
    for (const mod of MODULES) {
      const n = countsFor(mod, ka, kb)[kind];
      const prefix = PREFIX[mod];
      const named = NAMED[kind].filter(([id]) => id.startsWith(prefix));
      for (let i = 0; i < n; i++) {
        const fields = FIELDS[mod];
        const pre = named[i];
        const id = pre ? pre[0] : `${prefix}${String(seq++).padStart(3, "0")}`;
        const message = pre ? pre[1] : `${fields[(i + seq) % fields.length]} ${ISSUES[(i + KIND_ORDER.indexOf(kind)) % ISSUES.length]}`;
        const base = 40 + ((i * 37 + seq) % 400);
        const [v1, v2] = kind === "newly_failing" ? [0, base] : kind === "fixed" ? [base, 0] : kind === "worse" ? [base, base * 2 + 30] : [base * 2 + 30, base];
        out[kind].push({ check_id: id, module: mod, severity: SEVERITIES[(i + seq) % (kind === "newly_failing" ? 4 : 3)], message, v1_affected: v1, v2_affected: v2 });
      }
    }
    out[kind].sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity] || x.check_id.localeCompare(y.check_id));
  }
  return out;
}

function plural(n: number, word: string): string {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

export function fixtureCompare(a: string, b: string): CompareSummary {
  const ka = numberOf(a);
  const kb = numberOf(b);
  if (!RUNS.some((r) => r.id === a) || !RUNS.some((r) => r.id === b)) throw new FixtureNotFound(`/runs/${a}/vs/${b}/summary`);
  const objects: CompareObject[] = MODULES.map((module) => {
    const before = side(module, ka);
    const after = side(module, kb);
    return { module, label: L.objects.find((o) => o.module === module)?.label ?? module, before, after, score_change: r1((after.score ?? 0) - (before.score ?? 0)), ...countsFor(module, ka, kb) };
  });
  const sum = (key: ChangeKind) => objects.reduce((n, o) => n + (key === "newly_failing" ? o.newly_failing : o[key]), 0);
  const total = (s: "before" | "after") => objects.reduce((n, o) => n + (o[s]?.records_checked ?? 0), 0);
  const added = (k: number) => (k >= 8 ? 0 : k === 7 ? 5 : 11);
  const addedBetween = Math.max(0, added(ka) - added(kb));
  const compared = MODULES.reduce((n, m) => n + rulesAt(m, Math.min(ka, kb)), 0);
  const since = `${state.baseline === a ? "the baseline" : "the earlier run"} of ${formatDate(RUNS.find((r) => r.id === a)!.run_at, "date")}`;
  const method =
    `Rules are compared on the common set: the ${plural(compared, "rule")} that ran cleanly in both runs. ` +
    (addedBetween ? `${plural(addedBetween, "rule")} added since ${since} ${addedBetween === 1 ? "is" : "are"} excluded. ` : `No rules were added since ${since}. `) +
    "A rule counts as changed when it flips between failing no records and some, or fails at least 10% and 10 records more or fewer.";
  return {
    a: { id: a, run_at: RUNS.find((r) => r.id === a)!.run_at, label: null },
    b: { id: b, run_at: RUNS.find((r) => r.id === b)!.run_at, label: null },
    objects,
    totals: { records_checked_before: total("before"), records_checked_after: total("after"), newly_failing: sum("newly_failing"), fixed: sum("fixed"), worse: sum("worse"), better: sum("better"), rules_compared: compared, rules_added: addedBetween, rules_dropped: 0 },
    method,
  };
}

function fixtureVersionCompare(v1: string, v2: string, module?: string): VersionCompare {
  const ka = numberOf(v1);
  const kb = numberOf(v2);
  const all = changesFor(ka, kb);
  const checks = module ? (Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.filter((c) => c.module === module)])) as typeof all) : all;
  return { v1: head(ka), v2: head(kb), delta: {}, checks };
}

// ── Jobs ─────────────────────────────────────────────────────────────────────────────────────

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function stages(kind: string, current: string | null, failed = false): JobStage[] {
  const plan: Record<string, [string, string][]> = {
    extraction: [["connect", "Connecting"], ["read", "Reading tables"], ["store", "Storing data"], ["register", "Registering version"], ["analyse", "Analysis"]],
    analysis: [["load", "Loading data"], ["checks", "Running checks"], ["insights", "AI insights"], ["report", "Building report"]],
    config_load: [["connect", "Connecting"], ["read", "Reading configuration"], ["store", "Storing snapshot"], ["derive", "Deriving flows"]],
  };
  let seen = current === null;
  return plan[kind].map(([id, label]) => {
    if (id === current) {
      seen = true;
      return { id, label, status: failed ? "failed" : "running" };
    }
    return { id, label, status: seen ? "queued" : "done" } as JobStage;
  });
}

const done = (kind: string): JobStage[] => stages(kind, null).map((s) => ({ ...s, status: "done" as const }));

const TABLES_ECC: JobTable[] = [
  { table: "MARA", status: "live", rows: 61816, expected: 61816 },
  { table: "MARC", status: "live", rows: 148230, expected: 148230 },
  { table: "MBEW", status: "live", rows: 96104, expected: 96104 },
  { table: "BUT000", status: "live", rows: 48210, expected: 48210 },
  { table: "LFA1", status: "live", rows: 12884, expected: 12884 },
];

function jobs(): Job[] {
  const list: Job[] = [...state.started];
  if (fixtureParam("job") === "running") {
    const now = Math.floor(Date.now() / 1000);
    list.push({
      id: "dl-e0000000-0000-4000-8000-0000000000e1",
      kind: "extraction",
      status: "running",
      label: "Material master",
      stage: "read",
      stages: stages("extraction", "read"),
      percent: 42,
      rows_done: 168400,
      rows_total: 400662,
      message: "Reading MARC",
      tables: [
        { table: "MARA", status: "live", rows: 61816, expected: 61816 },
        { table: "MARC", status: "running", rows: 106584, expected: 148230 },
        { table: "MBEW", status: "queued", rows: 0, expected: 96104 },
      ],
      error: null,
      result: null,
      started_at: now - 190,
      updated_at: now,
      finished_at: null,
      system_id: ECC.id,
      version_id: "e0000000-0000-4000-8000-0000000000e1",
      modules: ["material_master"],
    });
  }
  if (fixtureParam("job") === "queued" || fixtureParam("queue") === "busy") {
    // Step 10: a queued analysis with its place in the queue (GET /jobs carries queue_position on queued jobs).
    const now = Math.floor(Date.now() / 1000);
    list.push({
      id: "an-q0000000-0000-4000-8000-0000000000q1",
      kind: "analysis",
      status: "queued",
      label: "Material master",
      stage: null,
      stages: stages("analysis", null).map((s) => ({ ...s, status: "queued" as const })),
      percent: 0,
      rows_done: 0,
      rows_total: 0,
      message: "Waiting for a worker",
      tables: [],
      error: null,
      result: null,
      started_at: now - 40,
      updated_at: now - 40,
      finished_at: null,
      system_id: ECC.id,
      modules: ["material_master"],
      queue_position: 2,
    });
  }
  const R8 = RUNS[0].id;
  list.push(
    {
      id: `dl-failed-sf`,
      kind: "extraction",
      status: "failed",
      label: "Employee Central",
      stage: "connect",
      stages: stages("extraction", "connect", true),
      percent: 0,
      rows_done: 0,
      rows_total: 0,
      message: "",
      tables: [{ table: "EmpEmployment", status: "failed", rows: 0, expected: null }],
      error: "OData refused credentials (HTTP 401). Check the client id and secret in the system settings.",
      result: null,
      started_at: unix("2026-10-15T09:12:00Z"),
      updated_at: unix("2026-10-15T09:12:04Z"),
      finished_at: unix("2026-10-15T09:12:04Z"),
      system_id: SF.id,
      modules: ["employee_central"],
      retry: state.retried.has("dl-failed-sf") ? undefined : { via: "extract", body: { system_id: SF.id, modules: ["employee_central"] } },
    },
    {
      id: R8,
      kind: "analysis",
      status: "completed",
      label: "Analysis | ECC production",
      stage: null,
      stages: done("analysis"),
      percent: 100,
      rows_done: 400662,
      rows_total: 400662,
      message: "",
      tables: [],
      error: null,
      result: null,
      started_at: unix("2026-10-16T05:05:18Z"),
      updated_at: unix("2026-10-16T05:17:00Z"),
      finished_at: unix("2026-10-16T05:17:00Z"),
      system_id: ECC.id,
      version_id: R8,
    },
    {
      id: `dl-${R8}`,
      kind: "extraction",
      status: "completed",
      label: "Material master, Business partner and 13 more",
      stage: null,
      stages: done("extraction"),
      percent: 100,
      rows_done: 400662,
      rows_total: 400662,
      message: "",
      tables: TABLES_ECC,
      error: null,
      result: null,
      started_at: unix("2026-10-16T04:29:40Z"),
      updated_at: unix("2026-10-16T04:41:00Z"),
      finished_at: unix("2026-10-16T04:41:00Z"),
      system_id: ECC.id,
      version_id: R8,
      modules: MODULES,
    },
    {
      id: "cl-ecc",
      kind: "config_load",
      status: "completed",
      label: "Configuration | ECC production",
      stage: null,
      stages: done("config_load"),
      percent: 100,
      rows_done: 0,
      rows_total: 0,
      message: "",
      tables: [],
      error: null,
      result: null,
      started_at: unix("2026-10-12T06:00:00Z"),
      updated_at: unix("2026-10-12T06:03:20Z"),
      finished_at: unix("2026-10-12T06:03:20Z"),
      system_id: ECC.id,
    },
  );
  return list;
}

/** A job a fixture write started: queued, nothing read yet. */
function startedJob(kind: Job["kind"], id: string, label: string, systemId: string, modules?: string[]): Job {
  const now = Math.floor(Date.now() / 1000);
  return { id, kind, status: "queued", label, stage: null, stages: stages(kind === "config_sync" ? "config_load" : kind, null).map((s) => ({ ...s, status: "queued" as const })), percent: 0, rows_done: 0, rows_total: 0, message: "Queued", tables: [], error: null, result: null, started_at: now, updated_at: now, finished_at: null, system_id: systemId, modules };
}

// ── Systems ──────────────────────────────────────────────────────────────────────────────────

export function systemsExtended(): SAPSystemExtended[] {
  const base = { sysnr: null, username: null, company_id: null, auth_type: null, token_url: null, description: null, is_active: true, config_last_synced_at: null, config_sync_status: null, created_at: "2026-06-01T08:00:00Z", updated_at: "2026-10-16T04:41:00Z", last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, base_url: null, host: null, last_health_check: null, sap_release: null, last_analysis_at: null, role: "source", target_system_id: null } as const;
  return [
    { ...base, id: ECC.id, name: ECC.name, system_type: "ecc", host: "ecc-prd.example.internal", client: "100", sysnr: "00", auth_type: "rfc", environment: "PRD", health_status: "healthy", health_message: "RFC connection succeeded (client 100, 41 ms)", last_health_check: "2026-10-29T06:30:00Z", config_last_synced_at: "2026-10-12T06:03:20Z", config_sync_status: "completed", last_sync_at: "2026-10-16T04:41:00Z", last_sync_status: "completed" },
    { ...base, id: S4.id, name: S4.name, system_type: "s4hana_onprem", host: "s4-sbx.example.internal", client: "200", sysnr: "00", auth_type: "rfc", environment: "QAS", health_status: "healthy", health_message: "RFC connection succeeded (client 200, 55 ms)", last_health_check: "2026-10-29T06:30:00Z", last_sync_at: "2026-10-14T22:10:00Z", last_sync_status: "completed" },
    { ...base, id: SF.id, name: SF.name, system_type: "successfactors", client: null, base_url: "https://api.example.successfactors.com/odata/v2", company_id: "MERIDIANDEMO", auth_type: "oauth2_client_credentials", environment: "PRD", health_status: "auth_failed", health_message: "OData refused credentials (HTTP 401)", last_health_check: "2026-10-15T09:12:04Z" },
  ];
}

const TABLES: Record<string, string[]> = {
  material_master: ["MARA", "MAKT", "MARC", "MBEW"],
  business_partner: ["BUT000", "ADRC", "DFKKBPTAXNUM"],
  vendor_master: ["LFA1", "LFB1", "LFBK"],
  customer_master: ["KNA1", "KNB1", "KNVV"],
  gl_accounts: ["SKA1", "SKB1"],
  asset_accounting: ["ANLA", "ANLB"],
  controlling: ["CSKS", "CEPC"],
  purchasing: ["EKKO", "EKPO", "EINA"],
  sales_orders: ["VBAK", "VBAP"],
};

export function objectsOf(systemId: string): { system_type: string; objects: SystemObject[] } {
  const sys = systemsExtended().find((s) => s.id === systemId);
  if (!sys) throw new FixtureNotFound(`/systems/${systemId}/objects`);
  const analysed = systemId === ECC.id;
  return {
    system_type: sys.system_type,
    objects: systemId === SF.id
      ? ["employee_central", "compensation", "time_attendance"].map((o) => ({ object: o, tables: [], config_tables: [], scope_filters: [], date_window: [], last_download: null }))
      : MODULES.map((module) => ({
          object: module,
          tables: TABLES[module] ?? [],
          config_tables: [],
          scope_filters: [],
          date_window: [],
          last_download: analysed || systemId === S4.id ? { version_id: analysed ? RUNS[0].id : "s4-extract", at: analysed ? "2026-10-16T04:41:00Z" : "2026-10-14T22:10:00Z", status: "complete", records: recordsAt(module, 8) } : null,
        })),
  };
}

function extractionsOf(systemId: string): { versions: SystemVersion[]; download: null } {
  if (systemId === ECC.id) {
    const versions = [8, 7, 6, 5, 4, 3, 2, 1].map<SystemVersion>((k) => {
      const run = RUNS[RUNS.length - k];
      return {
        id: run.id,
        run_at: run.run_at,
        label: null,
        status: "complete",
        objects: MODULES,
        scope: {},
        records: Object.fromEntries(MODULES.map((m) => [m, recordsAt(m, k)])),
        analysed_at: run.run_at,
        rule_set: `${rulesAt("material_master", k)} rules on Material master`,
        baseline: state.baseline === run.id,
        analysable: true,
        dqs: Object.fromEntries(MODULES.map((m) => [m, shownAt(m, k).score])),
        field_status: [],
        extraction_complete: true,
        coverage: { read: 31, issues: [] },
        outliers: {},
      };
    });
    return { versions, download: null };
  }
  if (systemId === S4.id) {
    return {
      versions: [
        { id: "s4-extract", run_at: "2026-10-14T22:10:00Z", label: null, status: "extracted", objects: ["material_master", "business_partner"], scope: {}, records: { material_master: 142310, business_partner: 70170 }, analysed_at: null, rule_set: null, baseline: false, analysable: true, dqs: {}, field_status: [], extraction_complete: true, coverage: { read: 9, issues: [] }, outliers: {} },
      ],
      download: null,
    };
  }
  return { versions: [], download: null };
}

export function profilesOf(systemId: string): SyncProfile[] {
  if (systemId === ECC.id) {
    return [
      { id: "p-ecc-1", system_id: ECC.id, domain: "material_master", tables: ["MARA", "MAKT", "MARC", "MBEW"], schedule_cron: "0 4 * * 1", active: true, last_run_at: "2026-10-16T04:41:00Z", next_run_at: "2026-10-30T04:00:00Z", extraction_mode: "delta" },
      { id: "p-ecc-2", system_id: ECC.id, domain: "business_partner", tables: ["BUT000", "ADRC"], schedule_cron: "0 4 * * 1", active: true, last_run_at: "2026-10-16T04:41:00Z", next_run_at: "2026-10-30T04:00:00Z", extraction_mode: "full" },
    ];
  }
  if (systemId === S4.id) {
    return [{ id: "p-s4-1", system_id: S4.id, domain: "material_master", tables: ["MARA", "MARC"], schedule_cron: null, active: false, last_run_at: "2026-10-14T22:10:00Z", next_run_at: null, extraction_mode: "full" }];
  }
  return [];
}

function configLoadOf(systemId: string): ConfigLoad | { status: "never_loaded" } {
  if (systemId !== ECC.id) return { status: "never_loaded" };
  return {
    load_id: "load-ecc-1",
    system_id: ECC.id,
    system_type: "ecc",
    role: "source",
    origin: "manual",
    status: "completed",
    error: null,
    created_at: "2026-10-12T06:00:00Z",
    finished_at: "2026-10-12T06:03:20Z",
    flows_derived: true,
    config_status: "with_gaps",
    areas: [],
    areas_loaded: 11,
    areas_total: 12,
    current_area: null,
    summary: { loaded: 214, empty: 9, failed: 2, not_available: 6 },
    objects: [],
    history: { source: "CDHDR", table_logging_off: false, detail: "Change documents read for 90 days", available: true },
  };
}

// ── The router and the writes ────────────────────────────────────────────────────────────────

/** The answer to one step 3 read, or NONE when the path is not one of this step's. */
export function runsFixtureResponse(path: string, params: Params): unknown {
  if (path === "/runs/timeline") return fixtureTimeline(params.system_id ? String(params.system_id) : undefined, Number(params.limit ?? 8));
  const vs = /^\/runs\/([^/]+)\/vs\/([^/]+)\/summary$/.exec(path);
  if (vs) return fixtureCompare(decodeURIComponent(vs[1]), decodeURIComponent(vs[2]));
  if (path === "/versions/compare") return fixtureVersionCompare(String(params.v1), String(params.v2), params.module ? String(params.module) : undefined);
  if (path === "/versions") return versionsPage(params);
  const ver = /^\/versions\/([^/]+)$/.exec(path);
  if (ver) {
    const id = decodeURIComponent(ver[1]);
    if (id === FAILED_RUN) return failedHead();
    if (!RUNS.some((r) => r.id === id)) throw new FixtureNotFound(path);
    return head(numberOf(id));
  }
  if (path === "/jobs") return { jobs: jobs().slice(0, Number(params.limit ?? 100)) };
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (job) {
    const found = jobs().find((j) => j.id === decodeURIComponent(job[1]));
    if (!found) throw new FixtureNotFound(path);
    return found;
  }
  if (path === "/systems") return systemsExtended();
  const sys = /^\/systems\/([^/]+)\/(objects|versions|profiles)$/.exec(path);
  if (sys) {
    const id = decodeURIComponent(sys[1]);
    return sys[2] === "objects" ? objectsOf(id) : sys[2] === "versions" ? extractionsOf(id) : profilesOf(id);
  }
  const cfg = /^\/connectivity\/config-load\/([^/]+)$/.exec(path);
  if (cfg) return configLoadOf(decodeURIComponent(cfg[1]));
  return NONE;
}

/** What each write answers in fixture mode, with the state change it would make. */
export function fixtureAction(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "pin": {
      const id = String(args.id);
      state.baseline = args.pinned ? id : null;
      return { version_id: id, baseline: Boolean(args.pinned) };
    }
    case "archive": {
      const keep = Number(args.keepLatest);
      const newestFirst = versionsPage({ include_archived: false, limit: 200 }).versions.map((v) => v.id);
      const hide = newestFirst.slice(keep);
      hide.forEach((id) => state.archived.add(id));
      return { archived: hide.length };
    }
    case "restore": {
      const n = state.archived.size;
      state.archived = new Set();
      return { restored: n };
    }
    case "analyse": {
      const id = String(args.versionId);
      state.started.unshift(startedJob("analysis", id, "Analysis | ECC production", ECC.id));
      return { version_id: id, job_id: id, status: "pending" };
    }
    case "download":
      return { ok: true };
    case "retry": {
      const id = String(args.id);
      state.retried.add(id);
      const next = `dl-retry-${id.slice(-6)}`;
      state.started.unshift(startedJob("extraction", next, "Employee Central", SF.id, ["employee_central"]));
      return { job_id: next, status: "queued" };
    }
    case "test": {
      const id = String(args.id);
      state.tested[id] = true;
      const s = systemsExtended().find((x) => x.id === id);
      if (id === SF.id) return { connected: false, message: "OData refused credentials (HTTP 401). Check the client id and secret in the system settings." };
      return { connected: true, message: `${s?.system_type === "ecc" || s?.system_type === "s4hana_onprem" ? "RFC connection" : "OData connection"} to ${s?.name ?? "the system"} succeeded (client ${s?.client ?? "n/a"}, ${id === ECC.id ? 41 : 55} ms).` };
    }
    case "config-load": {
      const id = `cl-new-${String(args.id).slice(-4)}`;
      state.started.unshift(startedJob("config_load", id, "Configuration", String(args.id)));
      return { job_id: id, load_id: "load-new", status: "queued" };
    }
    case "extract": {
      const id = "dl-e0000000-0000-4000-8000-0000000000e2";
      state.started.unshift(startedJob("extraction", id, "Extraction", String(args.id), (args.objects as string[]) ?? []));
      return { job_id: id, status: "queued" };
    }
    default:
      throw new FixtureNotFound(`action ${name}`);
  }
}
