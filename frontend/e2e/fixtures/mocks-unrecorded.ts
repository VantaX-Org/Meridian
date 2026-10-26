/**
 * Endpoints the recording does not hold, built by hand in the shape the API answers (each block names its route
 * and response model). Without them the page that calls them shows "Could not reach the server":
 *  - the steward work list, /work/* (api/routes/work.py): Fix, an object's Records to fix and a record's fix sheet;
 *  - the fix analytics, /work/analytics/* (api/routes/work_analytics.py, api/services/work_analytics.py): Progress;
 *  - a golden record's explanation, /master-records/{id}/explain, and the match review queue, /match-scores
 *    (api/routes/merge_explain.py);
 *  - a golden record's cluster graph and merge history, /master-records/{id}/cluster-graph and /merge-events;
 *  - /audit?limit=100&offset=0 (the recording holds the same list without `offset`) and /audit/summary
 *    (api/routes/audit.py);
 *  - the glossary list, /glossary (api/routes/glossary.py): the seeded glossary is empty;
 *  - the run the Fix page names, /versions/{latest} (api/routes/versions.py): the recording holds it only in the list;
 *  - the current state (`scope=current`) of Fix work's /work reads, and of /insights/impact and /insights/proven-cost;
 *  - the report library, /reports/history, /reports/schedules, /reports/schedules/options
 *    (api/routes/report_library.py), and the catalogue with `compare` (the recording holds it without);
 *  - the caller's delivery log, /me/notifications/deliveries (api/routes/me_notifications.py);
 *  - the features a cost per blocked record can be set for, /settings/cost-model/features (api/routes/settings.py);
 *  - process discovery's catalogue and run list, /process-discovery/systems/{id}/catalogue and /runs
 *    (api/routes/process_discovery.py): the seeded tenant has no discovery runs;
 *  - the accounts payable process document of the vendor run, /business-process/{run}/accounts_payable
 *    (api/routes/business_process.py), which the process home reads.
 *
 * Every handler answers only a GET whose exact URL the recording lacks: a recorded response is never shadowed, so the
 * specs that read the recording see it unchanged (`unrecordedOnly`).
 *
 * The data sits on the recorded tenant: its runs (the latest controlling_1k run, the 25k material master run), its
 * rules and counts as the recorded findings give them, its users and its accounts payable master records. GET only;
 * anything else, and any run not modelled here, falls through to the next handler.
 */
import fs from "node:fs";
import type { Page, Request, Route } from "@playwright/test";
import businessProcessAp from "./business-process-ap.json";

/** The part of Page the mocks use: `route`, restricted to requests the recording does not answer. */
type Router = Pick<Page, "route">;
type Entry = { request: { method: string; url: string }; response: { content: { text?: string; encoding?: string } } };

const entriesOf = (har: string) => (JSON.parse(fs.readFileSync(har, "utf8")) as { log: { entries: Entry[] } }).log.entries;
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

/** `page.route` that falls through for every GET the recording holds (same path and query), so the HAR answers it. */
function unrecordedOnly(page: Page, har: string): Router {
  const recorded = new Set(entriesOf(har).filter((e) => e.request.method === "GET").map((e) => pathOf(e.request.url)));
  return {
    route: (url, handler, options) => page.route(url, (route: Route, request: Request) =>
      request.method() === "GET" && recorded.has(pathOf(request.url())) ? route.fallback() : handler(route, request), options),
  };
}

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The day the recording was made (fixtures.ts RECORDED_AT): the analytics' "today". */
const TODAY = "2026-10-19";
const SYSTEM_ID = "c7a18906-1555-40ba-a1b2-caf83188238e";
/** The newest finished run (controlling_1k) and the one before it, of the same uploads. */
const LATEST = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const PREVIOUS = "23b6a2e3-a2f7-43e4-b2cb-f5a3af560370";
const MATERIAL = "c1f752b7-ab20-441e-9b13-f47754f0e910";
/** The recorded tenant's users (GET /users). */
const DEV_ADMIN = { id: "06f708aa-2f01-412d-91f8-4d8ac5da7934", name: "Admin", email: "admin@meridian.local" };
const STEWARD = { id: "d5a97ed1-b4a7-4e12-bbf5-70a256502c97", name: "Sim steward", email: "steward@kmz-sim.local" };
const ADMIN = { id: "765803d5-b17d-4f3a-8e5a-77a61ee85fda", name: "Sim admin", email: "admin@kmz-sim.local" };

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof SEVERITIES)[number];

interface Rule {
  check_id: string;
  severity: Severity;
  dimension: string;
  message: string;
  field: string | null;
  /** Records failing the check in the run (findings.affected_count). */
  records: number;
  population: number;
  why: string | null;
  impact: string | null;
  authority: string;
  instruction: string | null;
}

interface WorkRow {
  record_key: string;
  name: string | null;
  checks: string[];
  values: Record<string, string>;
  assigned?: typeof STEWARD;
}

interface Run {
  module: string;
  scope: string;
  run_at: string;
  /** Distinct records on the run's work list, and their issues (every failing record check). */
  records: number;
  issues: number;
  critical: number;
  rules: Rule[];
  /** A page of the list: the first failing records of each rule. */
  rows: WorkRow[];
}

// ── Runs ─────────────────────────────────────────────────────────────────────

/** controlling_1k: the six rules with the most failing records, as the recorded config-aware score lists them. */
const CONTROLLING: Run = {
  module: "controlling", scope: "upload", run_at: "2026-10-16T05:17:46.264744+00:00",
  records: 1000, issues: 3120, critical: 291,
  rules: [
    { check_id: "CO003", severity: "critical", dimension: "completeness", message: "Cost centre validity start date is mandatory", field: "CSKS.DATAB",
      records: 63, population: 1000, authority: "sap_hard_constraint", instruction: "Enter the valid-from date in KS02.",
      why: "Cost centre master data is time-dependent. A blank start date leaves the validity interval undefined.",
      impact: "Postings dated in the period cannot find a valid cost centre version." },
    { check_id: "CO043", severity: "critical", dimension: "consistency", message: "Cost centre's company code is not assigned to its controlling area", field: "CSKS.BUKRS",
      records: 62, population: 1000, authority: "sap_hard_constraint", instruction: "Assign the company code to the controlling area (OX19) or correct it in KS02.",
      why: "A cost centre can only belong to a company code that is assigned to its controlling area (OX19, TKA02).",
      impact: "Postings to the cost centre fail the company code check." },
    { check_id: "CO020", severity: "critical", dimension: "completeness", message: "Cost element validity start date is mandatory", field: "CSKB.DATAB",
      records: 61, population: 1000, authority: "sap_hard_constraint", instruction: "Enter the valid-from date in KA02.",
      why: "Cost elements are time-dependent.", impact: "Postings cannot find a valid cost element version." },
    { check_id: "CO028", severity: "critical", dimension: "completeness", message: "Profit centre validity start date is mandatory", field: "CEPC.DATAB",
      records: 55, population: 1000, authority: "sap_hard_constraint", instruction: "Enter the valid-from date in KE52.",
      why: "Profit centres are time-dependent.", impact: "Postings cannot find a valid profit centre version." },
    { check_id: "CO021", severity: "critical", dimension: "completeness", message: "Cost element category is mandatory", field: "CSKB.KATYP",
      records: 51, population: 1000, authority: "sap_hard_constraint", instruction: "Set the cost element category in KA02.",
      why: "KATYP decides which CO transactions may post to the cost element (primary costs, revenue, allocation, settlement).",
      impact: "The cost element accepts no postings." },
    { check_id: "CO070", severity: "high", dimension: "consistency", message: "Cost element master has no G/L account in the chart of accounts", field: "CSKA.KSTAR",
      records: 1000, population: 1000, authority: "sap_hard_constraint", instruction: "Create the G/L account in the chart of accounts (FS00) or remove the cost element.",
      why: "Cost elements are keyed by chart of accounts and number, and the number must be a G/L account of that chart for the element to be postable from FI.",
      impact: "FI postings to the number cannot be mirrored to controlling." },
  ],
  rows: [
    { record_key: "KOKRS=1000|KOSTL=0000001007", name: "Maintenance workshop", checks: ["CO003", "CO043"], assigned: STEWARD,
      values: { "CSKS.KOKRS": "1000", "CSKS.KOSTL": "0000001007", "CSKS.DATAB": "", "CSKS.BUKRS": "2000" } },
    { record_key: "KOKRS=1000|KOSTL=0000001019", name: "Quality control", checks: ["CO003"], assigned: STEWARD,
      values: { "CSKS.KOKRS": "1000", "CSKS.KOSTL": "0000001019", "CSKS.DATAB": "" } },
    { record_key: "KOKRS=1000|KSTAR=0000400100", name: "Raw material consumption", checks: ["CO020", "CO021"],
      values: { "CSKB.KOKRS": "1000", "CSKB.KSTAR": "0000400100", "CSKB.DATAB": "", "CSKB.KATYP": "" } },
    { record_key: "KOKRS=1000|PRCTR=0000002005", name: "Spare parts", checks: ["CO028"],
      values: { "CEPC.KOKRS": "1000", "CEPC.PRCTR": "0000002005", "CEPC.DATAB": "" } },
    { record_key: "KTOPL=1000|KSTAR=0000000001", name: null, checks: ["CO070"],
      values: { "CSKA.KTOPL": "1000", "CSKA.KSTAR": "0000000001" } },
    { record_key: "KTOPL=1000|KSTAR=0000000002", name: null, checks: ["CO070"],
      values: { "CSKA.KTOPL": "1000", "CSKA.KSTAR": "0000000002" } },
  ],
};

/** material_master_25k: its eight failing rules as GET /objects/material_master records them. */
const MM_FIX = "Record is missing MAKT.MAKTX. In ECC: Set via MM02. In S/4HANA: Use MM02 or Fiori app F1602 (Manage Product Master Data).";
const MATERIAL_RUN: Run = {
  module: "material_master", scope: "upload", run_at: "2026-10-16T03:05:18.033366+00:00",
  records: 24712, issues: 26943, critical: 794,
  rules: [
    { check_id: "MM045", severity: "critical", dimension: "completeness", message: "Material description is missing", field: "MAKT.MAKTX",
      records: 658, population: 25000, authority: "best_practice", instruction: MM_FIX,
      why: "Material description (MAKT.MAKTX) is not maintained. This field supports downstream processes and reporting accuracy.",
      impact: "Missing Material description may cause incomplete data in related transactions and reports." },
    { check_id: "MM003", severity: "critical", dimension: "completeness", message: "Material type is mandatory - determines procurement and storage behaviour", field: "MARA.MTART",
      records: 136, population: 25000, authority: "sap_hard_constraint", instruction: "Set the material type in MM02 (ECC) or Fiori F1602 (S/4HANA).",
      why: "Material type controls which organisational levels are maintained, which fields are required and which valuation class is used.",
      impact: "Material cannot be used in MM, PP, SD, or FI without a valid material type." },
    { check_id: "DDIC-MARA-TYPE", severity: "high", dimension: "validity", message: "Value does not match the field's SAP data type (MARA)", field: null,
      records: 24576, population: 25000, authority: "sap_hard_constraint", instruction: null, why: null, impact: null },
    { check_id: "DDIC-MARA-LENGTH", severity: "high", dimension: "validity", message: "Value exceeds the field's SAP length / precision (MARA)", field: null,
      records: 145, population: 25000, authority: "sap_hard_constraint", instruction: null, why: null, impact: null },
    { check_id: "DT-MARA-ERSDA", severity: "medium", dimension: "validity", message: "Creation date is before 1970 or in the future", field: "MARA.ERSDA",
      records: 424, population: 25000, authority: "best_practice", instruction: null, why: null, impact: null },
    { check_id: "MM453", severity: "medium", dimension: "validity", message: "Material creation date is in the future", field: "MARA.ERSDA",
      records: 424, population: 25000, authority: "best_practice", instruction: null,
      why: "A record cannot be created after today. A future creation date comes from a direct load with a wrong date.",
      impact: "Date-driven selections such as new-material reports and release workflows skip the material." },
    { check_id: "MM014", severity: "medium", dimension: "completeness", message: "Net weight is recommended for logistics and shipping calculations", field: "MARA.NTGEW",
      records: 421, population: 25000, authority: "best_practice", instruction: null,
      why: "Net weight is used in shipping calculations, transportation planning, and customs declarations.",
      impact: "Shipping weight calculations in delivery processing (VL01N) are inaccurate." },
    { check_id: "MM640", severity: "medium", dimension: "validity", message: "Material description contains corrupted characters from a wrong code page", field: "MAKT.MAKTX",
      records: 159, population: 25000, authority: "best_practice", instruction: null,
      why: "Characters such as Ã, Â or the replacement character appear when UTF-8 text was loaded as a single-byte code page.",
      impact: "Descriptions print wrongly on documents and labels; searches by the real word do not find the material." },
  ],
  rows: [
    // MM045's first failing records, as GET /versions/{run}/findings/MM045/records records them
    ...["MAT00000010", "MAT00000041", "MAT00000042", "MAT00000084", "MAT00000110"].map((m) => ({
      record_key: `MATNR=${m}`, name: null, checks: ["MM045"], values: { "MAKT.MAKTX": "" } })),
    { record_key: "MATNR=MAT00000127", name: "Hex bolt M8 x 40", checks: ["MM003"], values: { "MARA.MTART": "" } },
    { record_key: "MATNR=MAT00000203", name: "Ball bearing 6204", checks: ["MM003", "MM014"], values: { "MARA.MTART": "", "MARA.NTGEW": "" } },
    { record_key: "MATNR=MAT00000001", name: "Pump housing", checks: ["DDIC-MARA-TYPE"], values: { "MARA.BRGEW": "12,5" } },
    { record_key: "MATNR=MAT00000318", name: "Gasket set", checks: ["MM453", "DT-MARA-ERSDA"], values: { "MARA.ERSDA": "2031-04-02" } },
  ],
};

const RUNS: Record<string, Run> = { [LATEST]: CONTROLLING, [MATERIAL]: MATERIAL_RUN };

const sevRank = (s: Severity) => SEVERITIES.indexOf(s);
const ruleOf = (run: Run, id: string) => run.rules.find((r) => r.check_id === id)!;
/** A record's severity: its worst rule's. */
const rowSeverity = (run: Run, row: WorkRow) => SEVERITIES[Math.min(...row.checks.map((c) => sevRank(ruleOf(run, c).severity)))];

/** The run a /work call reads: `version_id`, else the latest; undefined for a run this file does not model. */
function runFor(route: Route): [string, Run] | undefined {
  const vid = new URL(route.request().url()).searchParams.get("version_id") ?? LATEST;
  const run = RUNS[vid];
  return run ? [vid, run] : undefined;
}

// ── /work (api/routes/work.py) ───────────────────────────────────────────────

/** GET /work/summary: per object of the run, records and issues by work status. */
function summary(vid: string, run: Run) {
  const o = { module: run.module, records: run.records, open: run.records, issues: run.issues, critical: run.critical,
    proposed: 0, overdue: 0, statuses: { to_fix: run.records } };
  return { version_id: vid, scope: run.scope, built: true, objects: [o],
    totals: { records: o.records, open: o.open, issues: o.issues, critical: o.critical, proposed: 0, overdue: 0 } };
}

/** GET /work/groups: one row per check, worst first. */
function groups(vid: string, run: Run, q: URLSearchParams) {
  const object = q.get("module");
  const severity = q.get("severity");
  const text = q.get("q")?.toLowerCase();
  const rows = run.rules
    .filter(() => !object || object === run.module)
    .filter((r) => !severity || (severity === "blocking" ? sevRank(r.severity) <= 1 : r.severity === severity))
    .filter(() => q.get("proposed") !== "true")
    .filter((r) => !text || [r.check_id, r.message, r.field ?? ""].some((s) => s.toLowerCase().includes(text)))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.records - a.records || a.check_id.localeCompare(b.check_id))
    .map((r) => ({ check_id: r.check_id, module: run.module, severity: r.severity, dimension: r.dimension, message: r.message, field: r.field,
      records: r.records, population: r.population, proposed: 0, truncated: false, statuses: { to_fix: r.records }, open: r.records }));
  return { version_id: vid, built: true, total: rows.length, groups: rows };
}

/** GET /work/records: failing records, worst first. One page: `next` is null. */
function records(vid: string, run: Run, q: URLSearchParams) {
  const object = q.get("module");
  const check = q.get("check_id");
  const severity = q.get("severity");
  const status = q.get("status") ?? "open";
  const text = q.get("q")?.toLowerCase();
  const filtered = !!(check || severity || q.get("assigned") || q.get("proposed") || q.get("due") || q.get("part") || text);
  const items = run.rows
    .filter(() => !object || object === run.module)
    .filter((r) => !check || r.checks.includes(check))
    .filter((r) => !severity || (severity === "blocking" ? sevRank(rowSeverity(run, r)) <= 1 : rowSeverity(run, r) === severity))
    .filter(() => status === "all" || status === "open" || status === "to_fix")
    .filter((r) => q.get("assigned") !== "me" || r.assigned?.id === ADMIN.id)
    .filter((r) => q.get("assigned") !== "unassigned" || !r.assigned)
    .filter(() => q.get("proposed") !== "true" && !q.get("due"))
    .filter((r) => !text || r.record_key.toLowerCase().includes(text) || (r.name ?? "").toLowerCase().startsWith(text))
    .sort((a, b) => sevRank(rowSeverity(run, a)) - sevRank(rowSeverity(run, b)) || a.record_key.localeCompare(b.record_key))
    .map((r) => {
      const top = ruleOf(run, r.checks[0]);
      return {
        module: run.module, record_key: r.record_key, name: r.name, issues: r.checks.length, severity: rowSeverity(run, r),
        checks: r.checks, proposed: 0, status: "to_fix", due_at: null,
        assigned_to: r.assigned?.id ?? null, assignee_email: r.assigned?.email ?? null, top_message: top.message, top_field: top.field,
      };
    });
  // the run's whole count, as the API counts it (the page here holds only its first rows)
  const total = check ? ruleOf(run, check).records : filtered ? items.length : run.records;
  return { version_id: vid, total, total_capped: false, next: null, items };
}

/** GET /work/records/{module}/{key}: every check the record fails, its value and the rule behind it. */
function record(vid: string, run: Run, object: string, key: string, actions: readonly string[]) {
  const row = object === run.module ? run.rows.find((r) => r.record_key === key) : undefined;
  if (!row) return null;
  const issues = row.checks.map((c) => {
    const r = ruleOf(run, c);
    return {
      rule: { id: null, name: r.message, dimension: r.dimension, authority: r.authority, cost_at_risk: null, cost_per_record: null },
      others_failing: Math.max(r.records - 1, 0), failing: r.records, population: r.population,
      pass_rate: Math.round(((r.population - r.records) * 1000) / r.population) / 10, allowed_values: null,
      check_id: c, severity: r.severity, dimension: r.dimension, message: r.message, field: r.field,
      current_value: r.field ? row.values[r.field] ?? null : null, instruction: r.instruction, why_it_matters: r.why, sap_impact: r.impact,
      suggestion: null, status: "to_fix", issue_id: null, resolution: null, first_seen_at: run.run_at, reopened_count: 0,
      due_at: null, sla_state: null, decision: null,
    };
  });
  return {
    version_id: vid, module: object, record_key: key, name: row.name, status: "to_fix",
    assigned_to: row.assigned?.id ?? null, assignee_email: row.assigned?.email ?? null,
    values: row.values, issues, events: [], other_runs: null, golden_record: null,
    duplicates: { open: 0, href: `/mdm/golden/merge?${new URLSearchParams({ source: "cleaning", object, record: key })}` },
    currency: null,
    // as work.py resolves `can`: fix needs apply, sign_off approve, assign assign, comment analyse
    can: { fix: actions.includes("apply"), sign_off: actions.includes("approve"), assign: actions.includes("assign"), comment: actions.includes("analyse") },
  };
}

/** The recording's caller (an admin): the actions `can` reads. */
const RECORDED_ADMIN_ACTIONS = ["analyse", "apply", "approve", "assign"];

/**
 * The caller's actions, as GET /me/permissions answered the page (the recording's admin, or a spec's override such as
 * viewer-gating's viewer). The shell asks for them on every page; until it has, the recorded admin's stand.
 */
function callerActions(page: Page): () => Promise<readonly string[]> {
  let seen: readonly string[] | null = null;
  page.on("response", (r) => {
    if (!/\/api\/v1\/me\/permissions$/.test(new URL(r.url()).pathname)) return;
    r.json().then((b: { actions?: string[] }) => { seen = b.actions ?? []; }, () => {});
  });
  return async () => {
    for (let i = 0; seen === null && i < 50; i++) await new Promise((res) => setTimeout(res, 100));
    return seen ?? RECORDED_ADMIN_ACTIONS;
  };
}

async function mockWork(page: Router, actions: () => Promise<readonly string[]>) {
  const get = (re: RegExp, answer: (route: Route, vid: string, run: Run) => unknown) =>
    page.route(re, async (route) => {
      const hit = route.request().method() === "GET" ? runFor(route) : undefined;
      if (!hit) return route.fallback();
      const body = await answer(route, ...hit);
      return body === null
        ? route.fulfill(json({ detail: "This record does not fail any check in this run." }, 404))
        : route.fulfill(json(body));
    });
  const params = (route: Route) => new URL(route.request().url()).searchParams;
  await get(/\/api\/v1\/work\/summary(\?.*)?$/, (_r, vid, run) => summary(vid, run));
  await get(/\/api\/v1\/work\/groups(\?.*)?$/, (r, vid, run) => groups(vid, run, params(r)));
  await get(/\/api\/v1\/work\/records(\?.*)?$/, (r, vid, run) => records(vid, run, params(r)));
  await get(/\/api\/v1\/work\/records\/[^/?]+\/[^?]+(\?.*)?$/, async (r, vid, run) => {
    const [object, key] = new URL(r.request().url()).pathname.split("/").slice(-2).map(decodeURIComponent);
    return record(vid, run, object, key, await actions());
  });
  // scope=current (Fix work without ?run=): every modelled object at its own run, each row naming its run. Registered
  // last so it answers first; a call for one run falls through to the handlers above.
  const current = (re: RegExp, merge: (parts: [string, Run][], q: URLSearchParams) => unknown) =>
    page.route(re, (route) => (route.request().method() === "GET" && params(route).get("scope") === "current"
      ? route.fulfill(json(merge(Object.entries(RUNS), params(route))))
      : route.fallback()));
  await current(/\/api\/v1\/work\/summary(\?.*)?$/, (parts) => {
    const objects = parts.map(([vid, run]) => ({ ...summary(vid, run).objects[0], version_id: vid }));
    const sum = (k: "records" | "open" | "issues" | "critical") => objects.reduce((n, o) => n + o[k], 0);
    return { version_id: null, scope: null, mode: "current", version_ids: parts.map(([vid]) => vid), unbuilt: [], built: true, objects,
      totals: { records: sum("records"), open: sum("open"), issues: sum("issues"), critical: sum("critical"), proposed: 0, overdue: 0 } };
  });
  await current(/\/api\/v1\/work\/groups(\?.*)?$/, (parts, q) => {
    const all = parts.flatMap(([vid, run]) => groups(vid, run, q).groups.map((g) => ({ ...g, version_id: vid })));
    return { version_id: null, built: true, total: all.length, groups: all };
  });
  await current(/\/api\/v1\/work\/records(\?.*)?$/, (parts, q) => {
    const pages = parts.map(([vid, run]) => ({ vid, page: records(vid, run, q) }));
    const items = pages.flatMap(({ vid, page }) => page.items.map((i) => ({ ...i, version_id: vid })));
    return { version_id: null, total: pages.reduce((n, p) => n + p.page.total, 0), total_capped: false, next: null, items };
  });
}

// ── /work/analytics (api/services/work_analytics.py) ─────────────────────────

const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** Issues opened and closed per day: the vendor runs of 2 October, the controlling uploads of 16 October and the fixes since. */
const FLOWS: Record<string, [opened: number, closed: number]> = {
  "2026-10-02": [14, 0], "2026-10-07": [0, 3],
  "2026-10-16": [3260, 40], "2026-10-17": [0, 52], "2026-10-18": [0, 38], "2026-10-19": [0, 21],
};

/** GET /work/analytics/burndown: 90 days, with the server's projection (pace over the last 28 days). */
function burndown() {
  let open = 0;
  const days = Array.from({ length: 90 }, (_, i) => {
    const d = day(i - 89);
    const [opened, closed] = FLOWS[d] ?? [0, 0];
    open += opened - closed;
    return { day: d, open, opened, closed };
  });
  const openNow = days[89].open;
  const pace = Math.round(((days[89 - 28].open - openNow) / 28) * 100) / 100;
  return {
    version_id: LATEST, today: TODAY, days, open_now: openNow, open_records: CONTROLLING.records, fixed_7d: 151,
    pace_per_day: pace, pace_window_days: 28,
    projected_finish: pace > 0 ? day(Math.ceil(openNow / pace)) : null,
    runs: [
      { version_id: "461c63cf-06f6-4e18-8bac-22305823bdce", label: "controlling_1k", run_at: "2026-10-16T05:17:42.514161+00:00", issues: 3120, open_records: null },
      { version_id: "52fadc1b-9bf5-448e-87fa-4cc7544bc983", label: "controlling_1k", run_at: "2026-10-16T05:17:43.343933+00:00", issues: 3120, open_records: null },
      { version_id: PREVIOUS, label: "controlling_1k", run_at: "2026-10-16T05:17:44.399026+00:00", issues: 3120, open_records: null },
      { version_id: LATEST, label: "controlling_1k", run_at: CONTROLLING.run_at, issues: 3120, open_records: CONTROLLING.records },
    ],
  };
}

const fixTime = (fixed: number, median: number | null, p90: number | null) => ({ fixed, median_days: median, p90_days: p90 });

/** GET /work/analytics/time-to-fix?days=180 */
const TIME_TO_FIX = {
  window_days: 180, overall: fixTime(154, 1.2, 2.8),
  by_object: [{ module: "accounts_payable", ...fixTime(3, 5.0, 5.0) }, { module: "controlling", ...fixTime(151, 1.1, 2.6) }],
  by_check: [
    { check_id: "XREC001", module: "accounts_payable", ...fixTime(3, 5.0, 5.0) },
    { check_id: "CO021", module: "controlling", ...fixTime(22, 1.8, 2.9) },
    { check_id: "CO003", module: "controlling", ...fixTime(61, 1.2, 2.7) },
    { check_id: "CO043", module: "controlling", ...fixTime(68, 0.9, 2.1) },
  ],
  by_severity: [{ severity: "critical", ...fixTime(154, 1.2, 2.8) }],
};

/** GET /work/analytics/throughput: decisions per day and person over 30 days, open work per assignee. */
function throughput() {
  const PER_DAY: Record<string, Record<string, number>> = {
    "2026-10-07": { [ADMIN.name]: 3 },
    "2026-10-16": { [STEWARD.name]: 34, [ADMIN.name]: 9 }, "2026-10-17": { [STEWARD.name]: 41, [ADMIN.name]: 14 },
    "2026-10-18": { [STEWARD.name]: 29, [ADMIN.name]: 10 }, "2026-10-19": { [STEWARD.name]: 16, [ADMIN.name]: 5 },
  };
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = day(i - 29);
    const by = PER_DAY[d] ?? {};
    return { day: d, total: Object.values(by).reduce((a, b) => a + b, 0), by_person: by };
  });
  const people = [
    { person: STEWARD.name, user_id: STEWARD.id, accept: 72, edit: 38, not_an_issue: 6, accept_risk: 4, approve: 0, total: 120 },
    { person: ADMIN.name, user_id: ADMIN.id, accept: 4, edit: 3, not_an_issue: 2, accept_risk: 1, approve: 31, total: 41 },
  ];
  const kinds = ["accept", "edit", "not_an_issue", "accept_risk", "approve", "total"] as const;
  return {
    window_days: 30, days, people,
    totals: Object.fromEntries(kinds.map((k) => [k, people.reduce((a, p) => a + p[k], 0)])),
    workload: [
      { assignee_id: STEWARD.id, name: STEWARD.name, email: STEWARD.email, open: 125, critical: 125, overdue: 0 },
      { assignee_id: null, name: null, email: null, open: 875, critical: 166, overdue: 0 },
    ],
  };
}

/** GET /work/analytics/recurrence: issues that failed again after a fix. */
const RECURRENCE = {
  totals: { issues: 154, reopened: 4, reopens: 4, rate_pct: 2.6 },
  by_check: [
    { check_id: "CO003", module: "controlling", issues: 61, reopened: 3, reopens: 3, rate_pct: 4.9 },
    { check_id: "XREC001", module: "accounts_payable", issues: 3, reopened: 1, reopens: 1, rate_pct: 33.3 },
  ],
  by_system: [
    { scope: "upload", name: "Uploads", version_id: LATEST, issues: 151, reopened: 3, reopens: 3, rate_pct: 2.0 },
    { scope: SYSTEM_ID, name: "KMZ-SIM", version_id: "65988d5a-0243-4f9b-bdff-52779e71c6ed", issues: 3, reopened: 1, reopens: 1, rate_pct: 33.3 },
  ],
};

/**
 * GET /work/analytics/root-causes: the run's failing records by org unit in their keys. Controlling keys carry the
 * controlling area and chart of accounts, none of the org units the API groups by (company code, plant, sales org,
 * purchasing org, storage location), so the run has no dimension.
 */
const ROOT_CAUSES = { version_id: LATEST, source: "work_records", total_records: CONTROLLING.records, dimensions: [] };

/** GET /work/analytics/proposal-quality: per proposal source, in the API's order. */
function proposalQuality() {
  const row = (source: string, proposed: number, approved: number, exported: number, fixed: number, still: number) => ({
    source, proposed, approved, exported, fixed, still_failing: still,
    approval_rate_pct: proposed ? Math.round((1000 * approved) / proposed) / 10 : null,
    fix_rate_pct: fixed + still ? Math.round((1000 * fixed) / (fixed + still)) / 10 : null,
  });
  const sources = [row("rule", 96, 81, 74, 70, 4), row("steward", 41, 36, 30, 28, 2), row("cleaning", 0, 0, 0, 0, 0),
    row("simulation", 0, 0, 0, 0, 0), row("manual", 3, 3, 3, 3, 0)];
  const keys = ["proposed", "approved", "exported", "fixed", "still_failing"] as const;
  return { sources, totals: Object.fromEntries(keys.map((k) => [k, sources.reduce((a, s) => a + s[k], 0)])) };
}

/** GET /work/analytics/run-change: per object, new / fixed / still failing since the previous run. */
const RUN_CHANGE = {
  version_id: LATEST, previous: { version_id: PREVIOUS, label: "controlling_1k", run_at: "2026-10-16T05:17:44.399026+00:00" },
  objects: [{ module: "controlling", new: 12, fixed: 40, still_failing: 3068, not_comparable_checks: 0 }],
  totals: { new: 12, fixed: 40, still_failing: 3068 }, not_comparable_checks: 0,
};

async function mockWorkAnalytics(page: Router) {
  const get = (name: string, body: () => unknown) =>
    page.route(new RegExp(`/api/v1/work/analytics/${name}(\\?.*)?$`), (r) => (r.request().method() === "GET" ? r.fulfill(json(body())) : r.fallback()));
  await get("burndown", burndown);
  await get("time-to-fix", () => TIME_TO_FIX);
  await get("throughput", throughput);
  await get("recurrence", () => RECURRENCE);
  await get("root-causes", () => ROOT_CAUSES);
  await get("proposal-quality", proposalQuality);
  await get("run-change", () => RUN_CHANGE);
}

// ── MDM (api/routes/merge_explain.py) ────────────────────────────────────────

const THRESHOLDS = { auto_merge: 0.95, review_floor: 0.3 };
/** The golden record route of routes.json: business partner 2000103029, never merged (GET /master-records/{id}). */
const GOLDEN_ID = "d1a558fd-53e6-4789-8c64-cb3a5dbbf12e";
const GOLDEN_KEY = "2000103029";
const GOLDEN_FIELDS = { "BUT000.TYPE": "1", "ADRC.COUNTRY": "AU", "BUT000.TITLE": 4, "BUT000.PARTNER": GOLDEN_KEY };

/** ExplainResponse: a record never merged is explained against itself (source priority, no losers, no pairs). */
const EXPLAIN = {
  golden_record_id: GOLDEN_ID, key: GOLDEN_KEY, domain: "business_partner", members: [], golden_fields: GOLDEN_FIELDS,
  steward_overrides: {},
  survivorship: Object.fromEntries(Object.entries(GOLDEN_FIELDS).map(([f, v]) => [f, { value: String(v), winner_key: GOLDEN_KEY, rule: "source_priority", losers: [] }])),
  pairs: [], thresholds: THRESHOLDS,
};

/** explain_pair's output for two vendors: one row per compared field. */
function pairExplanation(attrs: [field: string, comparator: string, a: string, b: string, similarity: number, weight: number, threshold: number | null][]) {
  const weightTotal = attrs.reduce((s, [, , , , , w]) => s + w, 0);
  const total = Math.round((attrs.reduce((s, [, , , , sim, w]) => s + sim * w, 0) / weightTotal) * 10_000) / 10_000;
  const attributes = attrs.map(([field, comparator, a, b, similarity, weight, threshold]) => ({
    field, comparator, weight, threshold, skipped: false, similarity, value_a: a, value_b: b, masked: false,
    threshold_met: threshold === null || similarity >= threshold,
    contribution: Math.round(((similarity * weight) / weightTotal) * 10_000) / 10_000,
  }));
  return {
    attributes, total, weight_total: weightTotal, band: "steward_review", auto_action: "queued",
    fired: `review_floor ${THRESHOLDS.review_floor} <= total ${total.toFixed(4)} < auto_merge ${THRESHOLDS.auto_merge}`,
    thresholds: THRESHOLDS,
    rules_met: attributes.filter((x) => x.threshold_met).map((x) => x.field),
    rules_failed: attributes.filter((x) => !x.threshold_met).map((x) => x.field),
    constraint: null,
  };
}

/** Two vendor pairs in the review band (0.94 and 0.56), on the recorded accounts payable master records (V1 to V7). */
const REVIEW_PAIRS = [
  { id: "5b0c6f1e-3d2a-4c8b-9e71-0a4f2d6b8c13", a: "V1", b: "V2", a_record_id: "56cbec3b-36a3-4fd0-bbd9-d322cef776ff", b_record_id: "eab43a30-45d0-43da-bb71-60c82e7ed014",
    explanation: pairExplanation([
      ["LFA1.NAME1", "jaro_winkler", "Alpha Industrial", "Alpha Industrial Supplies", 0.88, 0.5, 0.85],
      ["LFA1.ORT01", "exact", "Johannesburg", "Johannesburg", 1, 0.2, null],
      ["LFA1.STCD1", "exact", "4010000001", "4010000001", 1, 0.3, null],
    ]) },
  { id: "8e2d4a90-7f1b-4b6c-a3d5-c9e0f1a2b347", a: "V4", b: "V5", a_record_id: "af34ce3b-2270-4c94-ae98-6d1fa2bd8986", b_record_id: "75452b97-5cd2-48be-99a1-3ffa23e1cac3",
    explanation: pairExplanation([
      ["LFA1.NAME1", "jaro_winkler", "Delta Supplies", "Epsilon Parts", 0.52, 0.5, 0.85],
      ["LFA1.ORT01", "exact", "Cape Town", "Pretoria", 0, 0.2, null],
      ["LFA1.STCD1", "exact", "4020000004", "4020000004", 1, 0.3, null],
    ]) },
].map((p) => ({
  id: p.id, domain: "accounts_payable", a: p.a, b: p.b, total: p.explanation.total, band: "review", auto_action: "queued",
  steward_decision: null, constraint: null, explanation: p.explanation,
  field_scores: Object.fromEntries(p.explanation.attributes.map((x) => [x.field, x.similarity])),
  a_record_id: p.a_record_id, b_record_id: p.b_record_id, same_cluster: false,
}));

/** GET /match-scores (PairListResponse), filtered and paged as the API does; `bands` counts under the same filters. */
function matchScores(q: URLSearchParams) {
  const num = (k: string) => (q.get(k) === null ? null : Number(q.get(k)));
  const [lo, hi] = [num("min_score"), num("max_score")];
  const record = q.get("record");
  const keys = record ? [record, record.split("|")[0].split("=")[1]].filter(Boolean) : null;
  const pool = REVIEW_PAIRS
    .filter((p) => !q.get("domain") || p.domain === q.get("domain"))
    .filter((p) => lo === null || p.total >= lo)
    .filter((p) => hi === null || p.total <= hi)
    .filter((p) => !keys || keys.includes(p.a) || keys.includes(p.b));
  const band = q.get("band");
  const banded = pool.filter((p) => !band || p.band === band).sort((x, y) => y.total - x.total || x.id.localeCompare(y.id));
  const offset = num("offset") ?? 0;
  return {
    pairs: banded.slice(offset, offset + (num("limit") ?? 50)), total: banded.length,
    bands: { auto_merge: 0, review: pool.length, low: 0 }, thresholds: THRESHOLDS,
  };
}

/** ClusterGraphResponse: a record never merged is a cluster of one, with no pairs and no weak chains. */
const CLUSTER_GRAPH = {
  golden_record_id: GOLDEN_ID, nodes: [{ key: GOLDEN_KEY, degree: 0, is_survivor: true }], edges: [], weak_chains: [], auto_merge: THRESHOLDS.auto_merge,
};

async function mockMdm(page: Router) {
  const get = (url: string | RegExp, body: unknown) => page.route(url, (r) => (r.request().method() === "GET" ? r.fulfill(json(body)) : r.fallback()));
  await get(`**/api/v1/master-records/${GOLDEN_ID}/explain`, EXPLAIN);
  await get(`**/api/v1/master-records/${GOLDEN_ID}/cluster-graph`, CLUSTER_GRAPH);
  // list[MergeEventOut]: never merged, so no events
  await get(new RegExp(`/api/v1/master-records/${GOLDEN_ID}/merge-events(\\?.*)?$`), []);
  await page.route(/\/api\/v1\/match-scores(\?.*)?$/, (r) =>
    r.request().method() === "GET" ? r.fulfill(json(matchScores(new URL(r.request().url()).searchParams))) : r.fallback());
  // GET /match-scores/{id} (ReviewPairDetail): the pair plus both records' compared fields
  for (const p of REVIEW_PAIRS) {
    const side = (key: string, id: string, v: "value_a" | "value_b") =>
      ({ key, record_id: id, confidence: null, fields: Object.fromEntries(p.explanation.attributes.map((x) => [x.field, x[v]])) });
    await get(`**/api/v1/match-scores/${p.id}`, {
      ...p, record_a: side(p.a, p.a_record_id, "value_a"), record_b: side(p.b, p.b_record_id, "value_b"), default_survivor: p.a,
    });
  }
}

// ── Audit (api/routes/audit.py) ─────────────────────────────────────────────

/** GET /audit/summary: counts by action and entity type over 30 days, as the recorded audit list holds them. */
const AUDIT_SUMMARY = {
  summary: [
    { action: "analyse", entity_type: "versions", count: 6 },
    { action: "report.export", entity_type: "report", count: 3 },
    { action: "run", entity_type: "mining", count: 1 },
  ],
};

/** The audit page now sends offset=0; the recording answered the same first page without it. */
async function mockAudit(page: Router) {
  await page.route(/\/api\/v1\/audit\?limit=100&offset=0$/, (r) =>
    r.fallback({ url: r.request().url().replace("&offset=0", "") }));
  await page.route(/\/api\/v1\/audit\/summary$/, (r) => (r.request().method() === "GET" ? r.fulfill(json(AUDIT_SUMMARY)) : r.fallback()));
}

// ── Glossary (api/routes/glossary.py) ────────────────────────────────────────

/** GlossaryTermSummary rows on the recorded objects' fields; "g1" is the term fixtures.ts details. */
const GLOSSARY_AT = "2026-10-01T08:00:00Z";
const term = (id: string, table: string, field: string, name: string, domain: string, s4: boolean, status: string, ai: boolean, rules: number) => ({
  id, sap_table: table, sap_field: field, technical_name: `${table}.${field}`, business_name: name, domain, mandatory_for_s4hana: s4,
  status, ai_drafted: ai, last_reviewed_at: status === "active" ? GLOSSARY_AT : null, review_cycle_days: 180, linked_rules_count: rules,
});
const GLOSSARY = [
  term("g1", "LFB1", "AKONT", "Reconciliation account", "accounts_payable", true, "active", false, 2),
  term("g2", "MARA", "MTART", "Material type", "material_master", true, "active", false, 1),
  term("g3", "MAKT", "MAKTX", "Material description", "material_master", false, "active", false, 2),
  term("g4", "MARA", "NTGEW", "Net weight", "material_master", false, "under_review", true, 1),
  term("g5", "CSKS", "DATAB", "Cost centre valid from", "controlling", true, "active", false, 1),
  term("g6", "CSKB", "KATYP", "Cost element category", "controlling", true, "under_review", true, 1),
];

/** GET /glossary (GlossaryListResponse), filtered and paged as the API does. */
function glossary(q: URLSearchParams) {
  const text = q.get("search")?.toLowerCase();
  const terms = GLOSSARY
    .filter((t) => !q.get("domain") || t.domain === q.get("domain"))
    .filter((t) => !q.get("status") || t.status === q.get("status"))
    .filter((t) => q.get("mandatory_for_s4hana") === null || String(t.mandatory_for_s4hana) === q.get("mandatory_for_s4hana"))
    .filter((t) => q.get("ai_drafted") === null || String(t.ai_drafted) === q.get("ai_drafted"))
    .filter((t) => !text || [t.business_name, t.sap_table, t.sap_field, t.technical_name].some((v) => v.toLowerCase().includes(text)));
  const page = Number(q.get("page") ?? 1);
  const perPage = Number(q.get("per_page") ?? 50);
  return { terms: terms.slice((page - 1) * perPage, page * perPage), total: terms.length, page, per_page: perPage };
}

async function mockGlossary(page: Router) {
  await page.route(/\/api\/v1\/glossary(\?.*)?$/, (r) =>
    r.request().method() === "GET" ? r.fulfill(json(glossary(new URL(r.request().url()).searchParams))) : r.fallback());
}

// ── Runs (api/routes/versions.py) ────────────────────────────────────────────

/** GET /versions/{latest}: VersionResponse, the same row the recorded GET /versions list holds for the run. */
async function mockLatestRun(page: Router, har: string) {
  const entries = entriesOf(har);
  const list = entries.find((e) => /\/api\/v1\/versions\?limit=100&offset=0$/.test(e.request.url))?.response.content;
  if (!list?.text) return;
  const text = list.encoding === "base64" ? Buffer.from(list.text, "base64").toString("utf8") : list.text;
  const run = (JSON.parse(text) as { versions: { id: string }[] }).versions.find((v) => v.id === LATEST);
  if (!run) return;
  await page.route(new RegExp(`/api/v1/versions/${LATEST}$`), (r) => (r.request().method() === "GET" ? r.fulfill(json(run)) : r.fallback()));
}

/**
 * Value at risk and proven cost of the current state (`scope=current`, api/routes/insights.py), which Value at risk
 * and the executive summary read without ?run=: the recording holds them without a scope, which for the recorded
 * tenant (no priced feature, no proven cost) is the same answer.
 */
async function mockCurrentMoney(page: Router, har: string) {
  const entries = entriesOf(har);
  for (const name of ["impact", "proven-cost"]) {
    const hit = entries.find((e) => new RegExp(`/api/v1/insights/${name}$`).test(e.request.url))?.response.content;
    if (!hit?.text) continue;
    const body = JSON.parse(hit.encoding === "base64" ? Buffer.from(hit.text, "base64").toString("utf8") : hit.text) as object;
    await page.route(new RegExp(`/api/v1/insights/${name}\\?scope=current$`), (r) =>
      (r.request().method() === "GET" ? r.fulfill(json({ ...body, version_id: null, scope: "current" })) : r.fallback()));
  }
}

// ── Report library (api/routes/report_library.py) ────────────────────────────

const RUN_LABEL = "controlling_1k";
/** ReportFileOut rows: two board packs (one downloaded, one scheduled), a workbook and an object report run now. */
const REPORT_FILES = [
  { id: "4f1c2a7e-0b3d-4e59-9a61-2c8d7e5f3a01", kind: "board", name: "Board pack", format: "pdf", file_name: `board_${RUN_LABEL}.pdf`, size_bytes: 412_806,
    source: "download", schedule_id: null, by: ADMIN, created_at: "2026-10-19T03:58:12Z" },
  { id: "7a9e3b21-5c4d-4f6a-8b17-3e0f2d9c6b02", kind: "board", name: "Board pack", format: "pdf", file_name: `board_${RUN_LABEL}.pdf`, size_bytes: 409_331,
    source: "schedule", schedule_id: "c2e8d4f6-1a3b-4c5d-9e7f-6a8b0c2d4e01", by: null, created_at: "2026-10-19T05:00:41Z" },
  { id: "9b2d4f63-7e1a-4c8b-a5d9-0f3e6c1b8a03", kind: "workbook", name: "Analyst workbook", format: "xlsx", file_name: `workbook_${RUN_LABEL}.xlsx`, size_bytes: 1_284_552,
    source: "download", schedule_id: null, by: STEWARD, created_at: "2026-10-17T09:14:27Z" },
  { id: "1e5a7c94-3b2f-4d6e-8a0c-9f1b4d7e2c04", kind: "object", name: "Object report", format: "pdf", file_name: "object_controlling.pdf", size_bytes: 268_017,
    source: "run_now", schedule_id: "e4a6c8e0-3b5d-4f7a-8c9e-1b3d5f7a9c02", by: ADMIN, created_at: "2026-10-16T06:02:09Z" },
].map(({ by, ...f }) => ({
  ...f, version_id: LATEST, run_label: RUN_LABEL, run_at: CONTROLLING.run_at,
  created_by: by?.id ?? null, created_by_label: by?.name ?? null, can_delete: true,
}));

/** GET /reports/history (ReportFilePage), newest first, filtered by kind and paged. */
function reportHistory(q: URLSearchParams) {
  const items = REPORT_FILES.filter((f) => !q.get("kind") || f.kind === q.get("kind")).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const limit = Number(q.get("limit") ?? 25);
  const offset = Number(q.get("offset") ?? 0);
  return { total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
}

const TZ = "UTC";
/** list[ScheduleOut]: a weekly board pack to the admins and a monthly controlling object report, paused. */
const REPORT_SCHEDULES = [
  { id: "c2e8d4f6-1a3b-4c5d-9e7f-6a8b0c2d4e01", name: "Weekly board pack", kind: "board", format: "pdf", params: { scope: "latest", module: null },
    cadence: "weekly", time_of_day: "07:00", weekday: 0, day_of_month: null, timezone: TZ,
    recipient_user_ids: [ADMIN.id, DEV_ADMIN.id], recipient_channel_ids: [], enabled: true,
    last_run_at: "2026-10-19T05:00:41Z", last_status: "sent", next_run_at: "2026-10-26T07:00:00Z",
    created_by: ADMIN.id, created_at: "2026-10-05T10:12:00Z", summary: `Every Monday at 07:00 (${TZ})`, can_edit: true },
  { id: "e4a6c8e0-3b5d-4f7a-8c9e-1b3d5f7a9c02", name: "Controlling object report", kind: "object", format: "pdf", params: { scope: "upload", module: "controlling" },
    cadence: "monthly", time_of_day: "06:00", weekday: null, day_of_month: 1, timezone: TZ,
    recipient_user_ids: [STEWARD.id], recipient_channel_ids: [], enabled: false,
    last_run_at: "2026-10-16T06:02:09Z", last_status: "sent", next_run_at: null,
    created_by: ADMIN.id, created_at: "2026-10-16T05:40:00Z", summary: `Monthly on day 1 at 06:00 (${TZ})`, can_edit: true },
];

/** ScheduleOptions: the schedulable report types (api/services/report_history.py REPORT_TYPES), the recorded users, system and objects. */
const TYPES: [id: string, name: string, format: string, needsRun: boolean, needsModule: boolean][] = [
  ["board", "Board pack", "pdf", true, false], ["workbook", "Analyst workbook", "xlsx", true, false], ["executive", "Executive summary", "pdf", true, false],
  ["analysis", "Analysis report", "pdf", true, false], ["extraction", "Extraction report", "pdf", true, false], ["cleaning", "Cleaning and fixes", "pdf", true, false],
  ["trend", "Trend report", "pdf", true, false], ["owners", "Owner workload", "pdf", true, false], ["object", "Object report", "pdf", true, true],
  ["json", "Run data", "json", true, false], ["rules", "Rule catalogue", "pdf", false, true], ["dictionary", "Data dictionary", "pdf", false, false],
];
const SCHEDULE_OPTIONS = {
  timezone: TZ,
  types: TYPES.map(([id, name, format, needs_run, needs_module]) => ({ id, name, format, needs_run, needs_module })),
  users: [DEV_ADMIN, ADMIN, STEWARD].map((u) => ({ id: u.id, label: u.name, detail: u.email })),
  channels: [],
  systems: [{ id: SYSTEM_ID, label: "KMZ-SIM" }],
  modules: ["accounts_payable", "business_partner", "controlling", "material_master"],
};

async function mockReports(page: Router) {
  const get = (re: RegExp, body: (q: URLSearchParams) => unknown) =>
    page.route(re, (r) => (r.request().method() === "GET" ? r.fulfill(json(body(new URL(r.request().url()).searchParams))) : r.fallback()));
  await get(/\/api\/v1\/reports\/history(\?.*)?$/, reportHistory);
  await get(/\/api\/v1\/reports\/schedules$/, () => REPORT_SCHEDULES);
  await get(/\/api\/v1\/reports\/schedules\/options$/, () => SCHEDULE_OPTIONS);
  // The catalogue now names the run it compares with; the recording holds the same catalogue without `compare`.
  await page.route(/\/api\/v1\/reports\/catalogue\?.*&compare=[^&]+$/, (r) =>
    r.fallback({ url: r.request().url().replace(/&compare=[^&]+$/, "") }));
}

// ── Me (api/routes/me_notifications.py) ──────────────────────────────────────

/** GET /me/notifications/deliveries: the signed-in admin's own delivery log, newest first. */
const DELIVERIES = [
  { id: "a3c5e7f9-1b2d-4e6f-8a0c-2e4f6a8c0e01", channel: "email", kind: "digest", status: "sent", error: null, created_at: "2026-10-19T04:00:12Z" },
  { id: "b4d6f8a0-2c3e-4f7a-9b1d-3f5a7b9d1f02", channel: "in_app", kind: "critical", status: "sent", error: null, created_at: "2026-10-16T05:18:03Z" },
  { id: "c5e7a9b1-3d4f-4a8b-8c2e-4a6b8c0e2a03", channel: "email", kind: "critical", status: "failed", error: "SMTP connection refused", created_at: "2026-10-16T05:18:02Z" },
  { id: "d6f8b0c2-4e5a-4b9c-9d3f-5b7c9d1f3b04", channel: "email", kind: "test", status: "no_backend", error: null, created_at: "2026-10-02T05:20:44Z" },
];

async function mockMe(page: Router) {
  await page.route(/\/api\/v1\/me\/notifications\/deliveries(\?.*)?$/, (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const limit = Number(new URL(r.request().url()).searchParams.get("limit") ?? 20);
    return r.fulfill(json({ items: DELIVERIES.slice(0, limit) }));
  });
}

// ── Cost model (api/routes/settings.py) ──────────────────────────────────────

/**
 * GET /settings/cost-model/features: every target feature of db/seeds/config_impact_rules.yaml once, with its L1
 * (api/services/insights_impact.py impact_features). Static rule metadata, the same on every tenant.
 */
const L1 = { md: "master_data", h2r: "hire_to_retire", r2r: "record_to_report", plan: "plan_to_produce", o2c: "order_to_cash", p2p: "procure_to_pay" } as const;
const IMPACT_FEATURES: [feature: string, l1: keyof typeof L1][] = [
  ["Account Determination", "md"], ["All SuccessFactors Modules", "h2r"], ["Asset Capitalisation", "r2r"], ["Asset Retirement", "r2r"],
  ["BOM Management", "plan"], ["BP Duplicate Check", "md"], ["BP Role Assignment", "md"], ["Benefits Enrollment", "h2r"],
  ["CVI Integration", "md"], ["Compensation Planning", "h2r"], ["Compliance Training", "h2r"], ["Credit Management", "o2c"],
  ["Customer Creation", "o2c"], ["Customer Master Management", "o2c"], ["Delivery Processing", "o2c"], ["Depreciation Run", "r2r"],
  ["Dunning", "o2c"], ["F110 Automatic Payment", "p2p"], ["FI Posting / Invoice Verification", "p2p"], ["Financial Posting", "r2r"],
  ["Goal Cascade", "h2r"], ["Intercompany Reconciliation", "r2r"], ["Inventory Valuation", "md"], ["Invoice Due Date Calculation", "p2p"],
  ["Learning Assignment", "h2r"], ["Leave Management", "h2r"], ["MRP Planning", "md"], ["Maintenance Notification", "plan"],
  ["Manager Self-Service", "h2r"], ["Material Creation", "md"], ["PO Creation", "p2p"], ["Pay Equity Analysis", "h2r"],
  ["Payment Receipt Processing", "o2c"], ["Payroll Integration", "h2r"], ["Payroll Processing", "h2r"], ["Performance Reviews", "h2r"],
  ["Period Close", "r2r"], ["Preventive Maintenance", "plan"], ["Pricing Determination", "o2c"], ["Purchase Order Processing", "p2p"],
  ["Recruiting Pipeline", "h2r"], ["Release Strategy", "p2p"], ["Routing / Work Centre", "plan"], ["SF Onboarding 2.0", "h2r"],
  ["Sales Order Creation", "o2c"], ["Source Determination", "p2p"], ["Succession Nomination", "h2r"], ["Time Sheet Entry", "h2r"],
  ["Vendor Evaluation", "p2p"], ["Vendor Master Management", "p2p"], ["Withholding Tax Processing", "p2p"], ["Work Order Creation", "plan"],
];

async function mockCostModel(page: Router) {
  const features = IMPACT_FEATURES.map(([feature, l1]) => ({ feature, l1: L1[l1] }));
  await page.route(/\/api\/v1\/settings\/cost-model\/features$/, (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ features })) : r.fallback());
}

// ── Process discovery (api/routes/process_discovery.py) ──────────────────────

/**
 * GET /process-discovery/systems/{id}/catalogue (list[CatalogueEntry]) for the recorded ECC system, which has never
 * run discovery: every L1 of L1S (api/services/process_discovery) in order, named from sap/process_definitions.py,
 * "reference" coverage, no runs and no sources; `reason` is process_discovery.reason(l1, "ecc").
 */
const CLOUD_ONLY = "Connect the SuccessFactors / Ariba / Concur system to discover this process.";
const L1S: [l1: string, name: string, reason: string | null][] = [
  ["PTP", "Procure to Pay", null], ["OTC", "Order to Cash", null], ["R2R", "Record to Report", null], ["PP", "Plan to Produce", null],
  ["PM", "Plant Maintenance", null], ["QM", "Quality Management", null], ["PS", "Project System", null], ["WH", "Warehouse Management", null],
  ["HTR", "Hire to Retire", null], ["MDG", "Master Data Governance", null],
  ["SFX", "SuccessFactors", CLOUD_ONLY], ["ARB", "Ariba", CLOUD_ONLY], ["CNQ", "Concur", CLOUD_ONLY],
];
const CATALOGUE = L1S.map(([l1, name, reason]) => ({
  l1, name, coverage: "reference", reason, dq_defects: null, dq_version_id: null, last_run: null, in_progress: null, failed: null, sources: [],
}));

/**
 * GET /business-process/{vendor run}/accounts_payable: api/services/process_writer.generate_process_document over the
 * run's five recorded findings (GET /findings?version_id=…&limit=5), without SPRO config or config impact rows.
 */
const VENDOR_RUN = "65988d5a-0243-4f9b-bdff-52779e71c6ed";

async function mockProcess(page: Router) {
  const get = (re: RegExp, body: unknown) => page.route(re, (r) => (r.request().method() === "GET" ? r.fulfill(json(body)) : r.fallback()));
  await get(new RegExp(`/api/v1/process-discovery/systems/${SYSTEM_ID}/catalogue$`), CATALOGUE);
  // list[RunSummary]: no runs, whatever the l1 and limit
  await get(new RegExp(`/api/v1/process-discovery/systems/${SYSTEM_ID}/runs(\\?.*)?$`), []);
  await get(new RegExp(`/api/v1/business-process/${VENDOR_RUN}/accounts_payable$`), businessProcessAp);
}

/** `har`: the decompressed recording the page replays (fixtures.ts harFor). */
export async function mockUnrecorded(page: Page, har: string) {
  const router = unrecordedOnly(page, har);
  await mockWork(router, callerActions(page));
  await mockWorkAnalytics(router);
  await mockMdm(router);
  await mockAudit(router);
  await mockGlossary(router);
  await mockLatestRun(router, har);
  await mockCurrentMoney(router, har);
  await mockReports(router);
  await mockMe(router);
  await mockCostModel(router);
  await mockProcess(router);
}
