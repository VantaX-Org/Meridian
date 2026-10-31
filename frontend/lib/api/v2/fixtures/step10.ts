/**
 * Fixture answers for step 10 (`?fixture=1`): policy packs, scheduled digests, sandbox mode, record history and time
 * travel, run prediction with the queue position, and the natural language mode of the command line. This file owns
 * exactly the paths below; every other path answers NONE_STEP10 and falls through.
 *
 *   GET /policy-packs, POST /policy-packs/{id}/apply, /unapply, GET /policy-packs/{id}/evidence
 *   /digests (GET, POST), /digests/{id} (GET, PATCH, DELETE), /digests/{id}/send-now, /deliveries, /preview, /preview.json
 *   GET /admin/sandbox, POST /admin/sandbox/enter, /exit (and the 409 a decision on the real run gets in sandbox)
 *   GET /work/records/{module}/{key}/history, GET /objects/{module}/as-of, GET /work/records with policy= or as_of_run=
 *   GET /runs/predict
 *   GET /command/nl
 *
 * The packs are the shipped catalogue (sap/policy_packs.yaml) cut to the rules this fixture measures; a class is
 * breached when one of its critical rules fails, and only an applied pack's breached classes mark a cell. Start
 * parameters: `?sandbox=1` starts in sandbox mode, `?cost=none` leaves the run cost unpriced, `?queue=busy` puts
 * two jobs ahead in the queue.
 */
import { LIBRARY } from "./library";
import landscapeJson from "./landscape.json";
import runsJson from "./runs.json";
import rulesJson from "./rules.json";
import type { Landscape, LandscapeCell, RuleRow, WorkPage, WorkRow } from "../types";
import { DIMENSIONS } from "../types";
import type {
  Digest,
  DigestBody,
  DigestDelivery,
  DigestNumbers,
  HistoryEvent,
  HistoryRun,
  NlAnswer,
  NlMatch,
  ObjectAsOf,
  PolicyBreachClass,
  PolicyClass,
  PolicyEvidence,
  PolicyPack,
  PolicyRuleEvidence,
  RecordHistory,
  RunPrediction,
  SandboxState,
} from "../step10";
import { fixtureParam } from "../fixture";
import { fixtureTimeline } from "./runs";
import * as wf from "./work-fixture";

export const NONE_STEP10 = Symbol("no-step10-fixture");

type Params = Record<string, unknown>;

class Refused extends Error {
  response: { status: number; data: { detail: unknown } };
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.response = { status, data: { detail } };
  }
}

const landscape = landscapeJson as unknown as Landscape;
const runs = (runsJson as unknown as { versions: { id: string; run_at: string }[] }).versions; // newest first
const mmRules = (rulesJson as unknown as { rules: RuleRow[] }).rules;
const ECC = landscape.systems[0];
const LATEST = runs[0].id;
const NOW = "2026-10-20T08:00:00Z";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── policy packs ─────────────────────────────────────────────────────────────

interface FixtureFinding {
  module: string;
  severity: string;
  failing: number;
  total: number;
}

/** The findings of the current state the packs read: a rule absent here is not measured. */
const FINDINGS: Record<string, FixtureFinding> = Object.fromEntries(
  ["MM022", "MM232", "MM042", "MM324", "MM035", "MM033", "MM043", "QM001", "QM004", "QM058", "GL001", "GL002", "AP039", "AP018", "AP016", "AR018", "AR049", "BP007", "BP017"].map((id) => {
    const r = LIBRARY.find((x) => x.check_id === id);
    if (!r) throw new Error(`${id} is not in library.json`);
    return [id, { module: r.module, severity: r.severity, failing: r.failing, total: r.total }];
  }),
);

interface ClassDef {
  id: string;
  label: string;
  authority: string;
  fields: string[];
  rules: string[];
}
interface PackDef {
  id: string;
  name: string;
  authority: string;
  description: string;
  classes: ClassDef[];
}

const PACKS: PackDef[] = [
  {
    id: "gdpr",
    name: "GDPR personal data",
    authority: "Regulation (EU) 2016/679, General Data Protection Regulation",
    description: "Personal data of natural persons held in business partner, HR and SuccessFactors master data. The classes are the fields the regulation's accuracy and rectification duties reach; the rules are the catalogue checks that evidence each class is accurate and complete.",
    classes: [
      { id: "identity", label: "Identity of natural persons", authority: "GDPR Article 4(1) (personal data) and Article 5(1)(d) (accuracy)", fields: ["BUT000.NAME_FIRST", "BUT000.NAME_LAST", "BUT000.BIRTHDT", "PA0002.VORNA", "PA0002.NACHN", "PA0002.GBDAT"], rules: ["BP007", "BP008", "BP038", "HCM015", "HCM016", "PA031"] },
      { id: "contact", label: "Contact and address data", authority: "GDPR Article 5(1)(d) (accuracy) and Article 16 (right to rectification)", fields: ["ADR6.SMTP_ADDR", "ADR2.TEL_NUMBER", "ADRC.STREET", "ADRC.CITY1", "ADRC.POST_CODE1"], rules: ["BP017", "BP018", "BP020", "EC017", "EC018"] },
      { id: "national_identifier", label: "National identification numbers", authority: "GDPR Article 87 (processing of the national identification number)", fields: ["PA0002.PERID"], rules: ["HCM021", "PA030", "PA035"] },
      { id: "special_category", label: "Special categories of personal data", authority: "GDPR Article 9(1) (processing of special categories of personal data)", fields: ["PA0002.KONFE"], rules: [] },
    ],
  },
  {
    id: "sox",
    name: "SOX financial controls",
    authority: "Sarbanes-Oxley Act of 2002 (United States)",
    description: "Master data behind financial reporting and payments. The classes are the fields internal control over financial reporting depends on; the rules are the catalogue checks that evidence each class.",
    classes: [
      { id: "gl_master", label: "General ledger accounts", authority: "SOX Section 404(a) (management assessment of internal control over financial reporting)", fields: ["SKA1.SAKNR", "SKA1.KTOKS", "SKB1.BUKRS", "SKB1.WAERS", "SKB1.MITKZ"], rules: ["GL001", "GL002", "GL003", "GL006"] },
      { id: "journal_entries", label: "Journal entries", authority: "SOX Section 302 (corporate responsibility for financial reports) and Section 404(a)", fields: ["BKPF.BLART", "BKPF.BUDAT", "BSEG.HKONT", "BSEG.DMBTR"], rules: ["GL029", "GL035", "GL036"] },
      { id: "vendor_bank", label: "Vendor bank data", authority: "SOX Section 404(a) (controls over changes to vendor payment data)", fields: ["LFBK.BANKS", "LFBK.BANKL", "LFBK.BANKN", "LFBK.KOINH", "BNKA.SWIFT"], rules: ["AP018", "AP019", "AP039", "BKT001"] },
      { id: "customer_bank", label: "Customer bank data", authority: "SOX Section 404(a) (controls over receivables and incoming payments)", fields: ["KNBK.BANKS", "KNBK.BANKL", "KNBK.BANKN", "KNBK.KOINH"], rules: ["AR049", "AR050", "BKT021"] },
      { id: "inventory_valuation", label: "Inventory valuation", authority: "SOX Section 404(a) (controls over inventory valuation and stock account determination)", fields: ["MBEW.BKLAS", "MBEW.VPRSV", "MBEW.STPRS"], rules: ["MM035", "MM033", "MM043"] },
      { id: "payment_terms", label: "Payment terms and reconciliation accounts", authority: "SOX Section 404(a) (completeness and accuracy of payables and receivables)", fields: ["LFB1.ZTERM", "KNB1.ZTERM", "LFB1.AKONT", "KNB1.AKONT"], rules: ["AP014", "AP016", "AR018", "AR021"] },
    ],
  },
  {
    id: "gxp",
    name: "GxP batch and quality",
    authority: "21 CFR Part 211 (Current Good Manufacturing Practice for Finished Pharmaceuticals) and EudraLex Volume 4 (EU GMP)",
    description: "Batch, shelf life, inspection and deviation data a regulated manufacturer must keep complete and accurate. The rules are the catalogue checks that evidence each class.",
    classes: [
      { id: "batch_identity", label: "Batch identification", authority: "21 CFR 211.80(d) (lot identification) and 21 CFR 211.188 (batch production and control records)", fields: ["MCH1.MATNR", "MCH1.CHARG", "MCHA.WERKS", "MARA.XCHPF", "MARC.XCHPF"], rules: ["BATCH001", "BATCH002", "MM022", "MM232"] },
      { id: "shelf_life", label: "Shelf life and expiry", authority: "21 CFR 211.137 (expiration dating)", fields: ["MCH1.VFDAT", "MCH1.HSDAT", "MARA.MHDHB", "MARA.MHDRZ"], rules: ["BATCH006", "MM042", "MM324"] },
      { id: "quality_inspection", label: "Quality inspection and release", authority: "21 CFR 211.84 (testing and approval of components) and 21 CFR 211.165 (testing and release for distribution)", fields: ["QALS.ART", "QALS.MATNR", "QALS.WERK", "QAVE.VCODE", "MARC.QMATV"], rules: ["MM405", "QM001", "QM004"] },
      { id: "deviations", label: "Deviations and complaints", authority: "21 CFR 211.192 (production record review) and 21 CFR 211.198 (complaint files)", fields: ["QMEL.QMDAT", "QMEL.QMCOD", "QMEL.MATNR", "QMEL.CHARG"], rules: ["QM058", "QM059"] },
    ],
  },
];

/** A run's findings: older runs failed a little more, so the evidence of a run differs from today's. */
function findingsAt(run: string | null): Record<string, FixtureFinding> {
  const idx = run ? runs.findIndex((r) => r.id === run) : 0;
  if (idx <= 0) return FINDINGS;
  return Object.fromEntries(Object.entries(FINDINGS).map(([k, f]) => [k, { ...f, failing: f.failing ? Math.round(f.failing * (1 + idx * 0.08)) : 0 }]));
}

const passRate = (f: FixtureFinding): number => Math.round((1 - f.failing / f.total) * 10000) / 100;

function classEvidence(c: ClassDef, found: Record<string, FixtureFinding>): PolicyClass & { rules: PolicyRuleEvidence[] } {
  const rules: PolicyRuleEvidence[] = c.rules.map((id) => {
    const f = found[id];
    const name = LIBRARY.find((x) => x.check_id === id)?.name ?? null;
    return f ? { check_id: id, name, measured: true, module: f.module, severity: f.severity, pass_rate: passRate(f), failing_records: f.failing, total_records: f.total } : { check_id: id, name, measured: false, module: null, severity: null, pass_rate: null, failing_records: 0, total_records: 0 };
  });
  const measured = rules.filter((r) => r.measured);
  const rates = measured.map((r) => r.pass_rate).filter((x): x is number => x != null);
  return {
    id: c.id,
    label: c.label,
    authority: c.authority,
    fields: c.fields,
    rules,
    rules_count: c.rules.length,
    rules_measured: measured.length,
    pass_rate: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100 : null,
    failing_records: measured.reduce((n, r) => n + r.failing_records, 0),
    breached: measured.some((r) => r.severity === "critical" && r.failing_records > 0),
  };
}

function coverage(classes: (PolicyClass & { rules: PolicyRuleEvidence[] })[]): PolicyPack["coverage"] {
  return {
    fields_classified: new Set(classes.flatMap((c) => c.fields)).size,
    rules_evidencing: new Set(classes.flatMap((c) => c.rules.map((r) => r.check_id))).size,
    rules_measured: new Set(classes.flatMap((c) => c.rules.filter((r) => r.measured).map((r) => r.check_id))).size,
    failing_records: classes.reduce((n, c) => n + c.failing_records, 0),
    classes_breached: classes.filter((c) => c.breached).length,
  };
}

function packOf(id: string): PackDef {
  const p = PACKS.find((x) => x.id === id);
  if (!p) throw new Refused(404, "Policy pack not found");
  return p;
}

// ── digests ──────────────────────────────────────────────────────────────────

const ACTIVE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ["programme_lead", "data_steward", "data_owner", "analyst", "sap_basis", "platform_admin", "auditor", "viewer", "process_analyst"];

// ── state ────────────────────────────────────────────────────────────────────

interface State {
  seq: number;
  applied: Record<string, { applied: boolean; applied_at: string | null; applied_by: string | null; unapplied_at: string | null }>;
  digests: Digest[];
  deliveries: Record<string, DigestDelivery[]>;
  sandbox: SandboxState;
}

function build(): State {
  const start = fixtureParam("sandbox") === "1";
  return {
    seq: 0,
    applied: {
      sox: { applied: true, applied_at: "2026-10-05T09:12:00Z", applied_by: "R. Govender", unapplied_at: null },
      gxp: { applied: true, applied_at: "2026-10-12T14:40:00Z", applied_by: "Demo user", unapplied_at: null },
      gdpr: { applied: false, applied_at: "2026-09-01T08:00:00Z", applied_by: "R. Govender", unapplied_at: "2026-09-20T10:30:00Z" },
    },
    digests: [
      { id: "dg-1", name: "Monday leadership digest", audience: "role", role: "programme_lead", wave_id: null, cron: "0 7 * * 1", timezone: "Africa/Johannesburg", channel: "email", recipients: ["steering@demo-corp.example"], recipient_user_ids: ["u-2"], alert_channel_id: null, attach_pdf: true, enabled: true, last_sent_at: "2026-10-19T05:00:04Z", next_run_at: "2026-10-26T05:00:00Z", created_by: "u-me", created_at: "2026-09-02T08:00:00Z", updated_at: "2026-10-01T09:00:00Z" },
      { id: "dg-2", name: "Wave 2 readiness, Friday", audience: "wave", role: null, wave_id: "w-2", cron: "30 6 * * 5", timezone: "Europe/Berlin", channel: "alert_channel", recipients: [], recipient_user_ids: [], alert_channel_id: "ch-2", attach_pdf: false, enabled: true, last_sent_at: "2026-10-17T04:30:02Z", next_run_at: "2026-10-24T04:30:00Z", created_by: "u-2", created_at: "2026-09-15T08:00:00Z", updated_at: "2026-09-15T08:00:00Z" },
      { id: "dg-3", name: "Stewards' daily list", audience: "role", role: "data_steward", wave_id: null, cron: "0 6 * * *", timezone: "Africa/Johannesburg", channel: "webhook", recipients: [], recipient_user_ids: [], alert_channel_id: null, attach_pdf: false, enabled: false, last_sent_at: null, next_run_at: null, created_by: "u-me", created_at: "2026-10-10T08:00:00Z", updated_at: "2026-10-14T08:00:00Z" },
    ],
    deliveries: {
      "dg-1": [
        { id: "dd-13", due_at: "2026-10-19T05:00:00Z", manual: false, status: "sent", reason: null, delivered: 2, failed: 0, created_at: "2026-10-19T05:00:00Z", finished_at: "2026-10-19T05:00:04Z" },
        { id: "dd-12", due_at: "2026-10-12T05:00:00Z", manual: false, status: "sent", reason: "1 recipient refused: mailbox full", delivered: 1, failed: 1, created_at: "2026-10-12T05:00:00Z", finished_at: "2026-10-12T05:00:06Z" },
        { id: "dd-11", due_at: null, manual: true, status: "sent", reason: null, delivered: 2, failed: 0, created_at: "2026-10-08T13:20:00Z", finished_at: "2026-10-08T13:20:03Z" },
      ],
      "dg-2": [{ id: "dd-21", due_at: "2026-10-17T04:30:00Z", manual: false, status: "sent", reason: null, delivered: 1, failed: 0, created_at: "2026-10-17T04:30:00Z", finished_at: "2026-10-17T04:30:02Z" }],
      "dg-3": [],
    },
    sandbox: start ? { sandbox: true, since: "2026-10-20T07:15:00Z", by: "Demo user", runs: ["sbx-d3229ded"], skipped_deliveries: 3 } : { sandbox: false, since: null, by: null, runs: [], skipped_deliveries: 0 },
  };
}

let S: State | null = null;
const st = (): State => (S ??= build());
export function resetStep10Fixture(): void {
  S = null;
}
const nextId = (p: string): string => `${p}-${++st().seq + 100}`;

/** True while the fixture tenant is in sandbox mode. */
export const sandboxOn = (): boolean => st().sandbox.sandbox;

// ── policy breaches on the landscape and the receipt ─────────────────────────

function breachedClasses(module: string): PolicyBreachClass[] {
  const out: PolicyBreachClass[] = [];
  for (const p of PACKS) {
    if (!st().applied[p.id]?.applied) continue;
    for (const c of p.classes) {
      const rules = c.rules.filter((id) => FINDINGS[id]?.module === module && FINDINGS[id].severity === "critical" && FINDINGS[id].failing > 0);
      if (rules.length) out.push({ pack_id: p.id, class_id: c.id, label: c.label, authority: c.authority, rules });
    }
  }
  return out;
}

/** The landscape with policy_breaches on each cell of the latest run. */
export function withPolicyMarks(l: Landscape): Landscape {
  return { ...l, cells: l.cells.map((c: LandscapeCell) => ({ ...c, policy_breaches: c.run_id === LATEST ? breachedClasses(c.module).length : 0 })) };
}

/** The receipt's policy fields for one object. */
export function receiptPolicy(module: string): { policy_breaches: number; policy_breach_classes: PolicyBreachClass[] } {
  const classes = breachedClasses(module);
  return { policy_breaches: classes.length, policy_breach_classes: classes };
}

/** The status strip with the sandbox flag. */
export function withSandbox<T extends object>(strip: T): T & { sandbox: boolean } {
  return { ...strip, sandbox: st().sandbox.sandbox };
}

/** In sandbox mode a decision on the real run is refused, as api/services/sandbox.guard_scope refuses it. */
export function guardDecision(): void {
  if (st().sandbox.sandbox) throw new Refused(409, "Sandbox mode is on: decisions apply to the sandbox run only. Exit the sandbox to work on the real run.");
}

// ── the ledger with policy= and as_of_run= ───────────────────────────────────

function policyRules(policy: string): string[] {
  const [packId, classId] = policy.split(":");
  const p = PACKS.find((x) => x.id === packId);
  const c = classId ? p?.classes.find((x) => x.id === classId) : undefined;
  if (!p || (classId && !c)) throw new Refused(422, "policy must be a policy pack id or pack:class, e.g. sox:vendor_bank");
  return c ? c.rules : p.classes.flatMap((x) => x.rules);
}

/** GET /work/records when the ledger asks for a policy class or a past run: the same rows, narrowed. */
export function ledgerRecords(params: Params): WorkPage | typeof NONE_STEP10 {
  const policy = params.policy ? String(params.policy) : null;
  const asOf = params.as_of_run ? String(params.as_of_run) : null;
  if (!policy && !asOf) return NONE_STEP10;
  if (asOf && (params.version_id || params.scope === "current")) throw new Refused(422, "as_of_run is exclusive with version_id and scope=current");
  const run = asOf ? runs.find((r) => r.id === asOf) : null;
  if (asOf && !run) throw new Refused(404, "Run not found.");
  const rest = { ...params, policy: undefined, as_of_run: undefined, after: undefined, limit: 100000 } as Record<string, string | number | boolean | undefined>;
  let rows: WorkRow[] = wf.workRecords(rest).items;
  if (policy) {
    const ids = new Set(policyRules(policy));
    rows = rows.filter((r) => r.checks.some((c) => ids.has(c)));
  }
  if (run) {
    // An older run had fewer of today's failing records: each run back drops about a tenth of them.
    const back = runs.indexOf(run);
    rows = rows.filter((r) => (r.first_seen_at ?? "") <= run.run_at && hashOf(r.record_key) % 10 >= back);
  }
  const offset = params.after ? Number(params.after) || 0 : 0;
  const limit = Number(params.limit ?? 50);
  return { version_id: null, total: rows.length, total_capped: false, next: offset + limit < rows.length ? String(offset + limit) : null, items: rows.slice(offset, offset + limit) };
}

function hashOf(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// ── record history ───────────────────────────────────────────────────────────

function historyOf(module: string, key: string, limit: number): RecordHistory {
  const detail = wf.workRecord(module, key);
  const links = wf.recordLinks(module, key);
  const issue = detail.issues[0];
  const field = issue?.field ?? "";
  const current = issue?.current_value ?? null;
  const oldest = [...runs].reverse();
  const start = 2 + (hashOf(key) % 3);
  const earlier = current === null ? "" : current.length > 1 ? current.slice(0, -1) : "X";
  const out: HistoryRun[] = oldest.map((r, k) => {
    const failing = k >= start;
    const values: Record<string, string | null> = field ? { [field]: failing ? (k < start + 2 ? earlier || null : current) : current === null ? "EA" : current } : {};
    return { run_id: r.id, run_at: r.run_at, label: null, system_id: ECC.id, sandbox: false, failing, checks: failing ? detail.issues.map((i) => i.check_id) : [], values, work_status: failing ? (k === oldest.length - 1 ? detail.status : "to_fix") : null, severity: failing ? (issue?.severity ?? null) : null };
  });
  const firstFail = oldest[start];
  const events: HistoryEvent[] = [];
  if (firstFail) events.push({ at: firstFail.run_at, kind: "issue", action: "opened", check_id: issue?.check_id ?? null, run_id: firstFail.id, scope: firstFail.id, from_value: null, to_value: null, note: null, by: null, batch_id: null, batch_status: null });
  for (const h of links.history) events.push({ at: h.at, kind: "issue", action: h.action, check_id: h.check_id, run_id: LATEST, scope: LATEST, from_value: h.from_value, to_value: h.to_value, note: h.note, by: h.user, batch_id: null, batch_status: null });
  const decision = issue?.decision;
  if (decision) events.push({ at: decision.at ?? NOW, kind: "fix_proposed", action: "proposed", check_id: issue.check_id, run_id: LATEST, scope: LATEST, from_value: current, to_value: decision.value, note: null, by: "Demo user", batch_id: decision.batch_id, batch_status: decision.batch_status });
  events.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return { module, record_key: key, name: detail.name, systems: [ECC.id], runs: out.slice(-limit), events };
}

// ── an object as of a run ────────────────────────────────────────────────────

function asOf(module: string, runId: string): ObjectAsOf {
  const at = runs.find((r) => r.id === runId);
  if (!at) throw new Refused(404, "Run not found");
  const tl = fixtureTimeline(undefined, 8).runs;
  const run = [...tl].reverse().find((r) => (r.run_at ?? "") <= at.run_at && r.objects[module]);
  const cell = landscape.cells.find((c) => c.module === module && c.system_id === ECC.id);
  if (!run || !cell) throw new Refused(404, "The object was not measured at or before this run");
  const o = run.objects[module];
  const k = runs.findIndex((r) => r.id === run.id);
  const scale = 1 + k * 0.06;
  const dims = Object.fromEntries(DIMENSIONS.flatMap((d) => (cell.dimensions[d.key] == null ? [] : [[d.key, Math.round(Math.max(0, (cell.dimensions[d.key] ?? 0) - k * 0.5) * 10) / 10]])));
  const rules = module === "material_master" ? mmRules.map((r) => ({ check_id: r.check_id, severity: r.severity, dimension: r.dimension ?? null, failing: Math.round(r.affected_count * scale), total: r.total_count, pass_rate: Math.round((1 - (r.affected_count * scale) / r.total_count) * 10000) / 100 })) : [];
  return {
    module,
    as_of_run: runId,
    as_of_at: at.run_at,
    run_id: run.id,
    run_at: run.run_at ?? at.run_at,
    system_id: ECC.id,
    score: o.score,
    raw_score: o.raw_score,
    capped: o.capped,
    cap_level: o.capped ? (cell.cap_level ?? null) : cell.cap_level,
    breaches: o.capped ? cell.breaches : [],
    dimensions: dims,
    records_checked: cell.records_checked == null ? null : Math.round(cell.records_checked * (1 - k * 0.004)),
    failing_records: rules.reduce((n, r) => n + r.failing, 0) || Math.round((cell.open_work ?? 0) * scale),
    rules: rules.sort((a, b) => b.failing - a.failing || a.check_id.localeCompare(b.check_id)),
  };
}

// ── run prediction ───────────────────────────────────────────────────────────

/** Seconds per record of the fixture's past runs: 702 s for 400,662 records. */
const RATE = 702 / 400662;

function predict(params: Params): RunPrediction {
  const sid = params.system_id ? String(params.system_id) : null;
  const sys = sid ? landscape.systems.find((s) => s.id === sid) : ECC;
  if (sid && !sys) throw new Refused(404, "System not found");
  const delta = params.delta === true || params.delta === "true";
  const asked = String(params.modules ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const mods = asked.length ? [...new Set(asked)] : sys?.id === ECC.id ? landscape.cells.filter((c) => c.system_id === ECC.id).map((c) => c.module) : [];
  const objects = mods.map((m) => {
    const cell = landscape.cells.find((c) => c.module === m && c.system_id === sys?.id);
    if (!cell || cell.records_checked == null) return { module: m, runs: 0, records: null, seconds: null, seconds_low: null, seconds_high: null, confidence: "none" as const, basis: delta ? "full (no delta run yet)" : "full" };
    const records = delta ? Math.round(cell.records_checked * 0.06) : cell.records_checked;
    const seconds = Math.round(records * RATE * 10) / 10;
    return { module: m, runs: 8, records, seconds, seconds_low: Math.round(seconds * 0.86 * 10) / 10, seconds_high: Math.round(seconds * 1.19 * 10) / 10, confidence: delta ? ("medium" as const) : ("high" as const), basis: delta ? "delta" : "full" };
  });
  const measured = objects.filter((o) => o.seconds != null);
  const sum = (k: "seconds" | "seconds_low" | "seconds_high") => (measured.length ? Math.round(measured.reduce((n, o) => n + (o[k] ?? 0), 0) * 10) / 10 : null);
  const rank = { none: 0, low: 1, medium: 2, high: 3 } as const;
  const confidence = objects.reduce<RunPrediction["total"]["confidence"]>((m, o) => (rank[o.confidence] < rank[m] ? o.confidence : m), objects.length ? "high" : "none");
  const total = { records: measured.length ? measured.reduce((n, o) => n + (o.records ?? 0), 0) : null, seconds: sum("seconds"), seconds_low: sum("seconds_low"), seconds_high: sum("seconds_high"), confidence };
  const price = (s: number | null) => (s == null || total.records == null ? null : Math.round(((s / 3600) * 450 + (total.records / 1e6) * 120) * 100) / 100);
  const cost = fixtureParam("cost") === "none" || total.seconds == null ? null : { amount: price(total.seconds), low: price(total.seconds_low), high: price(total.seconds_high), currency: "ZAR", per_hour: 450, per_million_records: 120 };
  const busy = fixtureParam("queue") === "busy";
  const running = fixtureParam("job") === "running" ? 1 : 0;
  const queued = busy ? 2 : fixtureParam("job") === "queued" ? 1 : 0;
  const waiting = busy ? 2 : queued;
  return { system_id: sid, modules: mods, delta, objects, total, cost, queue: { broker: { default: waiting, extraction: 0 }, waiting, running_jobs: running, queued_jobs: queued, position: Math.max(waiting, queued) + 1 } };
}

// ── natural language ─────────────────────────────────────────────────────────

const FILLER = new Set("a an and are all any at be by data do does due error errors fail failing fails failure failures field fields find for from get give has have i in is issue issues it problem problems items its list me my of on or please record records rule rules show that the their them these this those to wants what where which who whose with within".split(" "));

function vocab(): Map<string, { slot: string; value: string | boolean; label: string }> {
  const v = new Map<string, { slot: string; value: string | boolean; label: string }>();
  const add = (phrase: string, slot: string, value: string | boolean, label: string) => v.set(phrase, { slot, value, label });
  for (const s of ["critical", "high", "medium", "low"]) add(s, "severity", s, `severity ${s}`);
  add("overdue", "due", "overdue", "past their SLA due date");
  add("due today", "due", "today", "due within a day");
  add("due this week", "due", "week", "due within seven days");
  add("this week", "due", "week", "due within seven days");
  add("assigned to me", "assigned", "me", "assigned to you");
  add("mine", "assigned", "me", "assigned to you");
  add("unassigned", "assigned", "unassigned", "not assigned to anyone");
  add("suggested", "proposed", true, "with a proposed value");
  add("waiting for approval", "status", "proposed", "status waiting for approval");
  add("exceptions", "status", "not_an_issue", "status not an issue");
  for (const o of landscape.objects) {
    add(o.label.toLowerCase(), "module", o.module, o.label);
    add(o.module.replace(/_/g, " "), "module", o.module, o.label);
  }
  add("materials", "module", "material_master", "Material master");
  add("vendors", "module", "accounts_payable", "Vendor master");
  add("customers", "module", "accounts_receivable", "Customer master");
  for (const s of landscape.systems) add(s.name.toLowerCase(), "system", s.id, `system ${s.name}`);
  add("ecc", "system", ECC.id, `system ${ECC.name}`);
  for (const p of PACKS) {
    add(p.id, "policy", p.id, `${p.name} fields`);
    for (const c of p.classes) {
      add(c.label.toLowerCase(), "policy", `${p.id}:${c.id}`, `${c.label.toLowerCase()} (${p.name})`);
      add(c.id.replace(/_/g, " "), "policy", `${p.id}:${c.id}`, `${c.label.toLowerCase()} (${p.name})`);
    }
  }
  add("vendor bank data", "policy", "sox:vendor_bank", "vendor bank data (SOX financial controls)");
  return v;
}

function nl(q: string): NlAnswer {
  const text = q.trim();
  if (!text) throw new Refused(422, "q must not be empty");
  const words = text.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").split(/\s+/).filter(Boolean);
  const v = vocab();
  const filter: Record<string, string | boolean> = {};
  const matched: NlMatch[] = [];
  const unmatched: string[] = [];
  const ignored: string[] = [];
  let i = 0;
  while (i < words.length) {
    let hit: { phrase: string; n: number } | null = null;
    for (let n = Math.min(5, words.length - i); n > 0; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      if (v.has(phrase)) {
        hit = { phrase, n };
        break;
      }
    }
    if (!hit) {
      const w = words[i];
      if (/^[a-z]{2,5}\d{3}$/.test(w) && !("check_id" in filter)) {
        filter.check_id = w.toUpperCase();
        matched.push({ phrase: w, slot: "check_id", value: w.toUpperCase(), label: `rule ${w.toUpperCase()}` });
      } else if (!FILLER.has(w) && !/^\d+$/.test(w)) unmatched.push(w);
      i += 1;
      continue;
    }
    const m = v.get(hit.phrase);
    if (m) {
      if (m.slot in filter && filter[m.slot] !== m.value) ignored.push(`"${hit.phrase}" (${m.label}): only one ${m.slot.replace(/_/g, " ")} per question`);
      else if (!(m.slot in filter)) {
        filter[m.slot] = m.value;
        matched.push({ phrase: hit.phrase, slot: m.slot, value: m.value, label: m.label });
      }
    }
    i += hit.n;
  }
  const head = matched.length ? `Records ${matched.map((m) => m.label).join(", ")}.${matched.some((m) => m.slot === "status") ? "" : " Open work only."}` : "No filter recognised: showing the open work.";
  const tail = [ignored.length ? `Ignored ${ignored.join("; ")}.` : "", unmatched.length ? `Not understood: ${unmatched.join(", ")}.` : ""].filter(Boolean);
  const qs = new URLSearchParams(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, val === true ? "true" : String(val)])).toString();
  return { filter, href: `/v2/work${qs ? `?${qs}` : ""}`, explanation: [head, ...tail].join(" "), unmatched_words: unmatched, matched, llm_used: false };
}

// ── digests: numbers and preview ─────────────────────────────────────────────

function digestOf(id: string): Digest {
  const d = st().digests.find((x) => x.id === id);
  if (!d) throw new Refused(404, "Digest not found");
  return d;
}

function numbers(d: Digest): DigestNumbers {
  const cells = landscape.cells.filter((c) => c.system_id === ECC.id);
  const wave = d.audience === "wave" ? { id: d.wave_id ?? "", modules: d.wave_id === "w-1" ? ["fi_gl", "asset_accounting", "controlling", "accounts_payable"] : d.wave_id === "w-3" ? ["mm_purchasing", "sd_sales_orders", "plant_maintenance"] : ["material_master", "business_partner", "accounts_receivable"] } : null;
  const mine = wave ? cells.filter((c) => wave.modules.includes(c.module)) : cells;
  const held = mine.filter((c) => c.capped).length;
  const crit = mine.reduce((n, c) => n + c.breaches.length, 0);
  const text = mine.length ? `${held} of ${mine.length} objects held under 85; fix MM003 and MM035 to release 2.` : "No object has been measured yet.";
  const waves = [
    { id: "w-1", name: "Wave 1: finance foundations", modules: ["fi_gl", "asset_accounting", "controlling", "accounts_payable"], target_date: "2026-11-16", gate_open: false, failing: ["Score 85 or more", "No critical rule over tolerance"] },
    { id: "w-2", name: "Wave 2: master data", modules: ["material_master", "business_partner", "accounts_receivable"], target_date: "2027-01-18", gate_open: false, failing: ["No critical rule over tolerance"] },
    { id: "w-3", name: "Wave 3: operations", modules: ["mm_purchasing", "sd_sales_orders", "plant_maintenance"], target_date: null, gate_open: true, failing: [] },
  ].filter((w) => !wave || w.id === wave.id);
  return {
    schedule_id: d.id,
    name: d.name,
    audience: d.audience,
    role: d.role,
    wave_id: d.wave_id,
    tenant: "Demo Corp",
    currency: "ZAR",
    generated_at: NOW,
    landscape: { held_under_85: held, objects: mine.length, critical_over_tolerance: crit, release_if_fixed: ["MM003", "MM035"], released: Math.min(2, held), text },
    score_moves: [
      { system: ECC.name, module: "material_master", before: 69.8, after: 71.8, delta: 2 },
      { system: ECC.name, module: "sd_sales_orders", before: 79.2, after: 81, delta: 1.8 },
      { system: ECC.name, module: "asset_accounting", before: 73.4, after: 72.6, delta: -0.8 },
    ].filter((m) => !wave || wave.modules.includes(m.module)),
    waves,
    approvals_waiting: wave ? 2 : 4,
    sla_breaches: wave ? 11 : 37,
    value_at_risk: {
      total: wave ? 1840000 : 4120000,
      top: [
        { check_id: "MM142", module: "material_master", cost_at_risk: 412300, failing_records: 1250 },
        { check_id: "MM003", module: "material_master", cost_at_risk: 288700, failing_records: 875 },
        { check_id: "AP039", module: "accounts_payable", cost_at_risk: 196000, failing_records: 128 },
      ].filter((v) => !wave || wave.modules.includes(v.module)),
    },
  };
}

function html(d: DigestNumbers): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  const rows = d.score_moves.map((m) => `<tr><td>${esc(m.system)}</td><td>${esc(m.module)}</td><td>${m.before.toFixed(1)}</td><td>${m.after.toFixed(1)}</td><td>${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.name)}</title></head><body><h1>${esc(d.name)}</h1><p>${esc(d.landscape.text)}</p><p>Approvals waiting: ${d.approvals_waiting}. SLA breaches: ${d.sla_breaches}.</p><h2>Score moves</h2><table><thead><tr><th>System</th><th>Object</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table><p>Value at risk: ${d.currency} ${(d.value_at_risk.total ?? 0).toLocaleString("en-US")}.</p></body></html>`;
}

function digestBodyCheck(v: DigestBody): void {
  if (!v.name?.trim()) throw new Refused(422, "name: at least 1 character");
  if (v.cron.trim().split(/\s+/).length !== 5) throw new Refused(422, "cron must be a five-field cron expression, e.g. '0 7 * * 1' (Mondays 07:00)");
  if (v.audience === "role" && (!v.role || !ROLES.includes(v.role))) throw new Refused(422, "A role digest needs a known role");
  if (v.audience === "wave" && !v.wave_id) throw new Refused(422, "A wave digest needs a wave of this tenant");
  if (v.channel === "alert_channel" && !v.alert_channel_id) throw new Refused(422, "Pick an alert channel of this tenant");
  if (v.channel === "email" && v.audience === "wave" && !v.recipients.length && !v.recipient_user_ids.length) throw new Refused(422, "An email digest for a wave needs recipients");
  if (v.recipients.some((r) => !ACTIVE_EMAIL.test(r))) throw new Refused(422, "not an email address");
}

/** The next run of a weekly or daily cron, as a fixed date in the fixture's week. */
function nextRunOf(cron: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const [m, h, , , dow] = cron.trim().split(/\s+/);
  const day = /^\d$/.test(dow ?? "") ? 25 + (Number(dow) % 7) : 21;
  return `2026-10-${String(Math.min(31, day)).padStart(2, "0")}T${String(Number(h) || 0).padStart(2, "0")}:${String(Number(m) || 0).padStart(2, "0")}:00Z`;
}

// ── routing ──────────────────────────────────────────────────────────────────

/** A step 10 read, or NONE_STEP10 for a path this file does not own. */
export function step10Read(path: string, params: Params): unknown {
  if (path === "/policy-packs") {
    const packs: PolicyPack[] = PACKS.map((p) => {
      const classes = p.classes.map((c) => classEvidence(c, FINDINGS));
      const s = st().applied[p.id];
      return { id: p.id, name: p.name, authority: p.authority, description: p.description, applied: Boolean(s?.applied), applied_at: s?.applied_at ?? null, applied_by: s?.applied_by ?? null, unapplied_at: s?.unapplied_at ?? null, coverage: coverage(classes), classes: classes.map(({ rules, ...rest }) => (void rules, rest)) };
    });
    return { packs, applied: packs.filter((p) => p.applied).length };
  }
  const ev = /^\/policy-packs\/([^/]+)\/evidence$/.exec(path);
  if (ev) {
    const p = packOf(decodeURIComponent(ev[1]));
    const run = params.run ? String(params.run) : null;
    if (run && !runs.some((r) => r.id === run)) throw new Refused(404, "Run not found");
    const classes = p.classes.map((c) => classEvidence(c, findingsAt(run)));
    const out: PolicyEvidence = { pack_id: p.id, name: p.name, authority: p.authority, applied: Boolean(st().applied[p.id]?.applied), scope: run ? "run" : "current", run_id: run, classes, coverage: coverage(classes) };
    return out;
  }
  if (path === "/digests") return { digests: clone(st().digests) };
  const dPrev = /^\/digests\/([^/]+)\/preview(\.json)?$/.exec(path);
  if (dPrev) {
    const n = numbers(digestOf(decodeURIComponent(dPrev[1])));
    return dPrev[2] ? n : html(n);
  }
  const dDel = /^\/digests\/([^/]+)\/deliveries$/.exec(path);
  if (dDel) {
    const id = decodeURIComponent(dDel[1]);
    digestOf(id);
    return { deliveries: clone(st().deliveries[id] ?? []) };
  }
  const dOne = /^\/digests\/([^/]+)$/.exec(path);
  if (dOne) return clone(digestOf(decodeURIComponent(dOne[1])));
  if (path === "/admin/sandbox") return clone(st().sandbox);
  const hist = /^\/work\/records\/([^/]+)\/(.+)\/history$/.exec(path);
  if (hist) return historyOf(decodeURIComponent(hist[1]), decodeURIComponent(hist[2]), Number(params.limit ?? 50));
  const ao = /^\/objects\/([^/]+)\/as-of$/.exec(path);
  if (ao) return asOf(decodeURIComponent(ao[1]), String(params.run ?? ""));
  if (path === "/runs/predict") return predict(params);
  if (path === "/command/nl") return nl(String(params.q ?? ""));
  if (path === "/work/records") return ledgerRecords(params);
  return NONE_STEP10;
}

/** A step 10 write, or NONE_STEP10 for a path this file does not own. */
export function step10Write(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  const pk = /^\/policy-packs\/([^/]+)\/(apply|unapply)$/.exec(path);
  if (method === "POST" && pk) {
    const p = packOf(decodeURIComponent(pk[1]));
    const on = pk[2] === "apply";
    const prev = st().applied[p.id];
    st().applied[p.id] = on ? { applied: true, applied_at: NOW, applied_by: "Demo user", unapplied_at: null } : { applied: false, applied_at: prev?.applied_at ?? null, applied_by: prev?.applied_by ?? null, unapplied_at: NOW };
    return on ? { id: p.id, applied: true, classes: p.classes.length } : { id: p.id, applied: false };
  }
  if (method === "POST" && path === "/digests") {
    const v = { recipients: [], recipient_user_ids: [], timezone: "UTC", channel: "email", attach_pdf: true, enabled: true, ...b } as unknown as DigestBody;
    digestBodyCheck(v);
    const d: Digest = { id: nextId("dg"), name: v.name, audience: v.audience, role: v.audience === "role" ? (v.role ?? null) : null, wave_id: v.audience === "wave" ? (v.wave_id ?? null) : null, cron: v.cron.trim().split(/\s+/).join(" "), timezone: v.timezone, channel: v.channel, recipients: [...new Set(v.recipients)], recipient_user_ids: v.recipient_user_ids, alert_channel_id: v.alert_channel_id ?? null, attach_pdf: v.attach_pdf, enabled: v.enabled, last_sent_at: null, next_run_at: nextRunOf(v.cron, v.enabled), created_by: "u-me", created_at: NOW, updated_at: NOW };
    st().digests.push(d);
    st().deliveries[d.id] = [];
    return clone(d);
  }
  const send = /^\/digests\/([^/]+)\/send-now$/.exec(path);
  if (method === "POST" && send) {
    const d = digestOf(decodeURIComponent(send[1]));
    const sandbox = st().sandbox.sandbox;
    const n = d.recipients.length + d.recipient_user_ids.length || 1;
    const del: DigestDelivery = { id: nextId("dd"), due_at: null, manual: true, status: sandbox ? "skipped" : "sent", reason: sandbox ? "sandbox" : null, delivered: sandbox ? 0 : n, failed: 0, created_at: NOW, finished_at: NOW };
    st().deliveries[d.id] = [del, ...(st().deliveries[d.id] ?? [])];
    if (sandbox) st().sandbox.skipped_deliveries += 1;
    else d.last_sent_at = NOW;
    return { delivery_id: del.id, status: del.status, reason: del.reason, delivered: del.delivered, failed: del.failed };
  }
  const one = /^\/digests\/([^/]+)$/.exec(path);
  if (one && method === "PATCH") {
    const d = digestOf(decodeURIComponent(one[1]));
    const keys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (!keys.length) throw new Refused(400, "No changes");
    const merged = { ...d, ...b } as Digest;
    digestBodyCheck(merged as unknown as DigestBody);
    Object.assign(d, merged, { cron: merged.cron.trim().split(/\s+/).join(" "), updated_at: NOW });
    if (["cron", "timezone", "enabled"].some((k) => keys.includes(k))) d.next_run_at = nextRunOf(d.cron, d.enabled);
    return clone(d);
  }
  if (one && method === "DELETE") {
    const id = decodeURIComponent(one[1]);
    digestOf(id);
    st().digests = st().digests.filter((x) => x.id !== id);
    delete st().deliveries[id];
    return undefined;
  }
  if (method === "POST" && path === "/admin/sandbox/enter") {
    if (st().sandbox.sandbox) throw new Refused(409, "The tenant is already in sandbox mode.");
    const copy = b.copy_run !== false;
    const vid = copy ? `sbx-${LATEST.slice(0, 8)}` : null;
    st().sandbox = { sandbox: true, since: NOW, by: "Demo user", runs: vid ? [vid] : [], skipped_deliveries: 0 };
    return { ...clone(st().sandbox), source_run_id: copy ? LATEST : null, sandbox_run_id: vid, copied: copy ? { analysis_versions: 1, findings: 794, finding_records: 25712, work_records: 25712, record_issues: 26104 } : {} };
  }
  if (method === "POST" && path === "/admin/sandbox/exit") {
    if (!st().sandbox.sandbox) throw new Refused(409, "The tenant is not in sandbox mode.");
    const had = st().sandbox.runs.length;
    st().sandbox = { sandbox: false, since: null, by: null, runs: [], skipped_deliveries: 0 };
    return { ...clone(st().sandbox), discarded: had ? { analysis_versions: had, findings: 794, work_records: 25712, record_issues: 26104 } : {} };
  }
  return NONE_STEP10;
}
