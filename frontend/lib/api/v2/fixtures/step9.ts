/**
 * Fixture answers for step 9 (`?fixture=1`): fix simulation, wave readiness certificates, impact in money, webhooks
 * and the automation settings, config drift alerts, contract enforcement and the per-table change log of an
 * extraction. This file owns exactly the paths below; every other path answers NONE_STEP9 and falls through.
 *
 *   POST /simulate/fix, GET /simulate/fix/top
 *   GET, POST /migration/waves/{id}/certificate, POST .../{cert}/sign, the .../{cert}/pdf download
 *   GET /impact/money
 *   /webhooks (GET, POST), /webhooks/events, /webhooks/{id} (PATCH, DELETE), /webhooks/{id}/test, /webhooks/{id}/deliveries
 *   GET, PUT /settings/automation
 *   GET /config/drift/alerts
 *   GET /objects/{module}/contracts, PUT /contracts/{id}/enforcement, GET /contracts/{id}/breaches
 *   GET /versions/{id}/changes
 *
 * The simulation is the fixture's stand-in for api/services/simulate_fix.py, worked on the landscape's own cells: the
 * fixed failing records lift their rule's dimension by their share of the records checked, the cap is drawn again
 * from the breaches left over tolerance (85 at one, 70 at two or more, only when the measured score is above it), and
 * a feature stays blocked while any of its rules still fails. The contracts are the roles fixture's (step 6c); this
 * file only adds their enforcement.
 */
import landscapeJson from "./landscape.json";
import receiptsJson from "./receipts.json";
import rulesJson from "./rules.json";
import runsJson from "./runs.json";
import workJson from "./work.json";
import type { DimensionKey, Landscape, LandscapeCell, Receipt, RuleRow, RunList, Verdict, WorkPage } from "../types";
import { DIMENSIONS } from "../types";
import type {
  AutomationSettings,
  CertSigner,
  CertVersion,
  ContractBreach,
  ContractThresholds,
  DriftAlert,
  Money,
  MoneyFeature,
  ObjectContract,
  SimSentence,
  SimState,
  SimulateBody,
  SimulateResult,
  TopFixes,
  VersionChanges,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "../step9";
import { fixtureParam } from "../fixture";
import { adminFixtureResponse } from "./admin";
import { FEATURES } from "./object";
import { rolesContracts } from "./roles";

export const NONE_STEP9 = Symbol("no-step9-fixture");

type Params = Record<string, unknown>;

class Refused extends Error {
  response: { status: number; data: { detail: unknown } };
  status: number;
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? (typeof detail === "string" ? detail : "Refused"));
    this.status = status;
    this.response = { status, data: { detail } };
  }
}

const landscape = landscapeJson as unknown as Landscape;
const receipts = receiptsJson as unknown as Record<string, Receipt>;
const mmRules = (rulesJson as unknown as { rules: RuleRow[] }).rules;
const runs = (runsJson as unknown as RunList).versions;
const workItems = (workJson as unknown as WorkPage).items;

const NOW = "2026-10-20T08:00:00Z";
const ME = "u-me";
const MM = "material_master";
const ECC = landscape.systems[0];
const CURRENT_RUN = runs[0].id;
const DAYS_PER_MONTH = 30.44;
/** The gate minimum of each wave, as the roles fixture's wave gates hold them; 80 for a wave without one. */
const GATE_MIN: Record<string, number> = { "w-1": 85, "w-2": 80 };
const NAMES: Record<string, string> = { "u-me": "Demo user", "u-rg": "R. Govender", "u-tm": "T. Mokoena", "u-pk": "P. Khumalo", "u-an": "A. Naidoo" };
/** The data owners the certificate needs: the roles fixture's owners, plus Customer master, which it leaves unowned. */
const OWNERS: Record<string, string> = { material_master: "u-rg", business_partner: "u-tm", asset_accounting: "u-pk", accounts_receivable: ME };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── state ────────────────────────────────────────────────────────────────────

interface State {
  seq: number;
  certs: Record<string, CertVersion[]>;
  webhooks: Webhook[];
  deliveries: Record<string, WebhookDelivery[]>;
  automation: AutomationSettings;
  enforcement: Record<string, { enforce: boolean; thresholds: ContractThresholds | null }>;
}

function build(): State {
  return {
    seq: 0,
    certs: {
      "w-2": [
        {
          id: "cert-w2-1",
          version: 1,
          status: "issued",
          sha256: "6f1d0c2a9be47e35c3a1b0f8d92e4c7718a65b3e0d4f2c9a8e7b6d5c4f3a2b1e",
          report_file_id: "rf-cert-1",
          issued_by: "R. Govender",
          issued_at: "2026-10-02T09:30:00Z",
          measured_on: [
            { module: "material_master", run_id: runs[2].id, run_at: runs[2].run_at },
            { module: "business_partner", run_id: runs[2].id, run_at: runs[2].run_at },
            { module: "accounts_receivable", run_id: runs[2].id, run_at: runs[2].run_at },
          ],
          signatures: [{ user_id: "u-rg", user: "R. Govender", statement: "Ready for mock load 1.", signed_at: "2026-10-02T11:05:00Z" }],
        },
      ],
    },
    webhooks: [
      { id: "wh-1", url: "hooks.slack.com", events: ["breach.new", "certificate.signed", "score.dropped"], active: true, description: "Data quality channel in Slack", created_by: "u-rg", created_at: "2026-09-12T08:00:00Z", updated_at: "2026-10-01T10:00:00Z" },
      { id: "wh-2", url: "integration.example.com", events: ["*"], active: false, description: "Ticketing bridge, paused during the upgrade", created_by: ME, created_at: "2026-09-20T08:00:00Z", updated_at: null },
    ],
    deliveries: {
      "wh-1": [
        { id: "dlv-104", event: "score.dropped", event_id: "ev-104", status: "retrying", attempts: 2, response_code: 502, error: "HTTP 502", created_at: "2026-10-20T07:41:00Z", last_attempt_at: "2026-10-20T07:42:00Z", next_attempt_at: "2026-10-20T07:44:00Z", delivered_at: null },
        { id: "dlv-103", event: "breach.new", event_id: "ev-103", status: "delivered", attempts: 1, response_code: 200, error: null, created_at: "2026-10-16T05:18:00Z", last_attempt_at: "2026-10-16T05:18:01Z", next_attempt_at: null, delivered_at: "2026-10-16T05:18:01Z" },
        { id: "dlv-102", event: "certificate.signed", event_id: "ev-102", status: "failed", attempts: 5, response_code: 404, error: "HTTP 404", created_at: "2026-10-02T11:05:00Z", last_attempt_at: "2026-10-02T11:20:00Z", next_attempt_at: null, delivered_at: null },
        { id: "dlv-101", event: "webhook.test", event_id: "ev-101", status: "delivered", attempts: 1, response_code: 200, error: null, created_at: "2026-09-12T08:01:00Z", last_attempt_at: "2026-09-12T08:01:01Z", next_attempt_at: null, delivered_at: "2026-09-12T08:01:01Z" },
      ],
      "wh-2": [],
    },
    automation: { drift_alerts: { enabled: true }, rule_mining: { min_records: 25 }, score_drop: { below: null, points: 5 } },
    // `?contracts=enforced` starts the fixture with the contract enforced, so a page load can show the baseline gate.
    enforcement: { "ct-1": { enforce: fixtureParam("contracts") === "enforced", thresholds: { min_score: 85, max_critical_breaches: 0, dimensions: { completeness: 80 } } } },
  };
}

let S: State | null = null;
const st = (): State => (S ??= build());
export function resetStep9Fixture(): void {
  S = null;
}
const nextId = (p: string): string => `${p}-${++st().seq + 200}`;

// ── fix simulation ───────────────────────────────────────────────────────────

interface RuleFacts {
  check_id: string;
  severity: string;
  failing: number;
  dimension: DimensionKey | null;
}

function cellFor(module: string, systemId?: string | null): LandscapeCell | undefined {
  return landscape.cells.find((c) => c.module === module && (!systemId || c.system_id === systemId));
}

function rulesFor(module: string): RuleFacts[] {
  if (module === MM) return mmRules.map((r) => ({ check_id: r.check_id, severity: r.severity, failing: r.affected_count, dimension: r.dimension ?? null }));
  return (receipts[module]?.breaches ?? []).map((b) => ({ check_id: b.check_id, severity: "critical", failing: b.failing ?? 0, dimension: null }));
}

const capOf = (raw: number, breaches: number): number | null => (breaches >= 2 && raw > 70 ? 70 : breaches === 1 && raw > 85 ? 85 : null);
const verdictOf = (score: number, breaches: number): Verdict => (score >= 85 && breaches === 0 ? "go" : score >= 75 ? "at-risk" : "no-go");

function wavesOf(module: string): { id: string; name: string }[] {
  const out = adminFixtureResponse("/migration/waves", {}) as { waves: { id: string; name: string; modules: string[] }[] };
  return out.waves.filter((w) => w.modules.includes(module)).map((w) => ({ id: w.id, name: w.name }));
}

function gates(module: string, score: number | null, breaches: number): SimState["wave_gate"] {
  return wavesOf(module).map((w) => {
    const min = GATE_MIN[w.id] ?? 80;
    const reasons = [...(breaches > 0 ? [`${breaches} critical rule(s) over tolerance`] : []), ...(score == null || score < min ? [`score below the wave minimum of ${min}`] : [])];
    return { wave_id: w.id, name: w.name, open: reasons.length === 0, reasons };
  });
}

function featureCounts(module: string, failing: Map<string, number>, receipt: Receipt | undefined): { blocked: number; degraded: number } {
  if (module !== MM) return { blocked: receipt?.features_blocked ?? 0, degraded: receipt?.features_degraded ?? 0 };
  const live = FEATURES.filter((f) => f.rules.some((id) => (failing.get(id) ?? 0) > 0));
  return { blocked: live.filter((f) => f.status === "blocked").length, degraded: live.filter((f) => f.status === "degraded").length };
}

function dimsOfCell(c: LandscapeCell): Partial<Record<DimensionKey, number>> {
  const out: Partial<Record<DimensionKey, number>> = {};
  for (const d of DIMENSIONS) {
    const v = c.dimensions[d.key];
    if (v != null) out[d.key] = v;
  }
  return out;
}

function stateOf(module: string, cell: LandscapeCell, failing: Map<string, number>, dims: Partial<Record<DimensionKey, number>>, raw: number, breaches: string[]): SimState {
  const cap = capOf(raw, breaches.length);
  const score = round2(cap ?? raw);
  const f = featureCounts(module, failing, receipts[module]);
  return {
    score,
    raw_score: round2(raw),
    cap_level: cap,
    breaches,
    dimensions: dims,
    verdict: verdictOf(score, breaches.length),
    features_blocked: f.blocked,
    features_degraded: f.degraded,
    wave_gate: gates(module, score, breaches.length),
  };
}

function sentenceAfter(before: SimSentence, cell: LandscapeCell, after: SimState): SimSentence {
  const cleared = cell.breaches.filter((b) => !after.breaches.includes(b)).length;
  const stillCapped = after.cap_level != null && (after.raw_score ?? 0) > after.cap_level;
  const top = new Set(before.release_if_fixed);
  const wasReleasable = cell.breaches.length > 0 && cell.breaches.every((b) => top.has(b));
  const stillBreaching = (id: string) => landscape.cells.some((c) => c !== cell && c.breaches.includes(id)) || after.breaches.includes(id);
  return {
    held_under_85: before.held_under_85 - (cell.capped && !stillCapped ? 1 : 0),
    objects: before.objects,
    critical_over_tolerance: before.critical_over_tolerance - cleared,
    release_if_fixed: before.release_if_fixed.filter(stillBreaching),
    released: Math.max(0, before.released - (wasReleasable && after.breaches.length === 0 ? 1 : 0)),
  };
}

export function simulateFixture(body: SimulateBody): SimulateResult {
  const cell = cellFor(body.module, body.system_id);
  if (!cell || (body.run_id && body.run_id !== cell.run_id)) throw new Refused(404, "Object not found for this run");
  const receipt = receipts[body.module];
  const rules = rulesFor(body.module);
  const known = new Set(rules.map((r) => r.check_id));
  const whole = new Set((body.rules ?? []).map((r) => r.trim()).filter(Boolean));
  const resolved = new Map<string, number>();
  for (const ref of body.records ?? []) {
    if (ref.module !== body.module) continue;
    const item = workItems.find((w) => w.module === ref.module && w.record_key === ref.record_key);
    for (const id of item?.checks ?? []) resolved.set(id, (resolved.get(id) ?? 0) + 1);
  }
  const before = new Map(rules.map((r) => [r.check_id, r.failing]));
  const after = new Map(rules.map((r) => [r.check_id, whole.has(r.check_id) ? 0 : Math.max(0, r.failing - (resolved.get(r.check_id) ?? 0))]));
  const checked = cell.records_checked ?? receipt?.records_checked ?? 0;
  const dimsBefore = dimsOfCell(cell);
  const dimsAfter = { ...dimsBefore };
  for (const r of rules) {
    const gained = (before.get(r.check_id) ?? 0) - (after.get(r.check_id) ?? 0);
    if (!r.dimension || gained <= 0 || !checked || dimsAfter[r.dimension] == null) continue;
    dimsAfter[r.dimension] = round2(Math.min(100, (dimsAfter[r.dimension] ?? 0) + (gained / checked) * 100));
  }
  const rawBefore = cell.raw_score ?? 0;
  const rawAfter = rawBefore + DIMENSIONS.reduce((s, d) => s + d.weight * ((dimsAfter[d.key] ?? 0) - (dimsBefore[d.key] ?? 0)), 0);
  const tolerance = receipt?.tolerance.rows ?? 25;
  const breachesAfter = cell.breaches.filter((id) => !known.has(id) || (after.get(id) ?? 0) > tolerance);
  const b = stateOf(body.module, cell, before, dimsBefore, rawBefore, [...cell.breaches]);
  // The stored receipt is what "before" reads; the fixture's cells carry it as shown.
  b.score = cell.score;
  b.cap_level = cell.cap_level;
  b.verdict = cell.verdict;
  const a = stateOf(body.module, cell, after, dimsAfter, rawAfter, breachesAfter);
  const sentenceBefore = landscape.sentence;
  return {
    module: body.module,
    run_id: cell.run_id,
    run_at: receipt?.run_at ?? null,
    system_id: cell.system_id,
    before: b,
    after: a,
    delta: {
      score: b.score == null || a.score == null ? null : round2(a.score - b.score),
      raw_score: b.raw_score == null || a.raw_score == null ? null : round2(a.raw_score - b.raw_score),
      breaches_cleared: cell.breaches.filter((id) => !breachesAfter.includes(id)),
      features_blocked: a.features_blocked - b.features_blocked,
      features_degraded: a.features_degraded - b.features_degraded,
      verdict_changed: a.verdict !== b.verdict,
      gates_opened: a.wave_gate.filter((g) => g.open && !b.wave_gate.find((x) => x.wave_id === g.wave_id)?.open).map((g) => g.wave_id),
    },
    method: {
      basis: "stored findings of the run, rescored with api/services/scoring.py score_module",
      reproduced: true,
      stored_score: cell.score,
      rules_fixed: [...whole].filter((id) => (before.get(id) ?? 0) > 0).sort(),
      rules_unknown: [...whole].filter((id) => !known.has(id)).sort(),
      records_resolved: Object.fromEntries([...resolved.entries()].filter(([id]) => known.has(id) && !whole.has(id)).map(([id, n]) => [id, Math.min(n, before.get(id) ?? 0)])),
      config_impact: "db/seeds/config_impact_rules.yaml over the failing rules, before and after",
      cached: false,
    },
    landscape: { before: sentenceBefore, after: sentenceAfter(sentenceBefore, cell, a) },
  };
}

function topFixture(params: Params): TopFixes {
  const mod = String(params.module ?? "");
  const cell = cellFor(mod, params.system_id ? String(params.system_id) : null);
  if (!cell) throw new Refused(404, "Object not found for this run");
  const rows = rulesFor(mod)
    .filter((r) => r.failing > 0)
    .map((r) => {
      const sim = simulateFixture({ module: mod, rules: [r.check_id] });
      return { check_id: r.check_id, severity: r.severity, failing: r.failing, after_score: sim.after.score, delta: sim.delta.score, after_verdict: sim.after.verdict, breach_cleared: sim.delta.breaches_cleared.includes(r.check_id), raw: sim.delta.raw_score ?? 0 };
    })
    .sort((x, y) => (y.delta ?? 0) - (x.delta ?? 0) || y.raw - x.raw || y.failing - x.failing || x.check_id.localeCompare(y.check_id))
    .slice(0, 5)
    .map(({ raw, ...rest }) => (void raw, rest));
  return { module: mod, run_id: cell.run_id, score: cell.score, rules: rows };
}

// ── certificates ─────────────────────────────────────────────────────────────

function waveById(id: string): { id: string; name: string; modules: string[] } {
  const out = adminFixtureResponse("/migration/waves", {}) as { waves: { id: string; name: string; modules: string[] }[] };
  const w = out.waves.find((x) => x.id === id);
  if (!w) throw new Refused(404, "Wave not found");
  return w;
}

function signersOf(modules: readonly string[]): CertSigner[] {
  const by = new Map<string, string[]>();
  for (const m of modules) {
    const uid = OWNERS[m];
    if (uid) by.set(uid, [...(by.get(uid) ?? []), m]);
  }
  return [...by.entries()].map(([user_id, mods]) => ({ user_id, name: NAMES[user_id] ?? user_id, modules: mods }));
}

function certificatesFixture(waveId: string): { wave_id: string; required_signers: CertSigner[]; versions: CertVersion[] } {
  const w = waveById(waveId);
  return { wave_id: waveId, required_signers: signersOf(w.modules), versions: clone(st().certs[waveId] ?? []) };
}

function issueFixture(waveId: string): unknown {
  const w = waveById(waveId);
  const objects = w.modules.flatMap((m) => {
    const cell = landscape.cells.find((c) => c.module === m && c.system_id === ECC.id);
    if (!cell) return [{ module: m, reason: "never measured" }];
    return cell.breaches.length ? [{ module: m, reason: "critical over tolerance", rules: [...cell.breaches] }] : [];
  });
  if (objects.length) throw new Refused(409, { detail: "The wave is not ready to certify.", objects }, "The wave is not ready to certify.");
  const list = (st().certs[waveId] ??= []);
  const version = (list[0]?.version ?? 0) + 1;
  const id = nextId("cert");
  const v: CertVersion = {
    id,
    version,
    status: "issued",
    sha256: `${(version * 7919).toString(16).padStart(8, "0")}${"a1b2c3d4".repeat(7)}`,
    report_file_id: nextId("rf"),
    issued_by: "Demo user",
    issued_at: NOW,
    measured_on: w.modules.map((m) => ({ module: m, run_id: CURRENT_RUN, run_at: runs[0].run_at })),
    signatures: [],
  };
  list.unshift(v);
  return { id, wave_id: waveId, version, status: "issued", sha256: v.sha256, report_file_id: v.report_file_id, measured_on: v.measured_on, required_signers: signersOf(w.modules) };
}

function signFixture(waveId: string, certId: string, body: { statement?: string | null } | undefined): unknown {
  const w = waveById(waveId);
  const cert = (st().certs[waveId] ?? []).find((c) => c.id === certId);
  if (!cert) throw new Refused(404, "Certificate not found.");
  const signers = signersOf(w.modules);
  if (!signers.some((s) => s.user_id === ME)) throw new Refused(403, "Only an owner of the wave's objects can sign its certificate.");
  if (cert.signatures.some((s) => s.user_id === ME)) throw new Refused(409, "You have already signed this certificate.");
  const statement = (body?.statement ?? "").trim() || "I confirm the objects of this wave meet the readiness criteria shown on this certificate.";
  cert.signatures.push({ user_id: ME, user: "Demo user", statement, signed_at: NOW });
  const signed = new Set(cert.signatures.map((s) => s.user_id));
  const waiting = signers.filter((s) => !signed.has(s.user_id)).map((s) => s.user_id).sort();
  if (waiting.length === 0) cert.status = "signed";
  return { id: cert.id, version: cert.version, status: cert.status, signed_by: [...signed].sort(), waiting_for: waiting };
}

// ── impact in money ──────────────────────────────────────────────────────────

/** The tenant cost model of the fixture, in the receipt's currency: the value per blocked record and month. */
const PRICES: Record<string, number> = { "Migration cockpit: material load": 6, "Material ledger actual costing": 9, "Embedded EWM product master": 4 };
const FIRST_BLOCKED: Record<string, string> = { "Migration cockpit: material load": "2026-08-14T05:11:00Z", "Material ledger actual costing": "2026-09-04T05:11:00Z", "Embedded EWM product master": "2026-08-14T05:11:00Z" };

function mmFeatures(): MoneyFeature[] {
  const failing = (id: string) => mmRules.find((r) => r.check_id === id)?.affected_count ?? 0;
  return [...FEATURES]
    .sort((a, b) => a.feature.localeCompare(b.feature))
    .map((f) => {
      const records = f.rules.reduce((s, id) => s + failing(id), 0);
      const price = PRICES[f.feature] ?? null;
      const monthly = price == null ? null : round2(records * price);
      const first = f.status === "blocked" ? (FIRST_BLOCKED[f.feature] ?? null) : null;
      const months = first ? round2((Date.parse(NOW) - Date.parse(first)) / 86_400_000 / DAYS_PER_MONTH) : 0;
      return {
        feature: f.feature,
        system_id: ECC.id,
        system: ECC.name,
        run_id: CURRENT_RUN,
        status: f.status,
        blocking_rules: [...f.rules],
        modules: [MM],
        records,
        value_per_record_month: price,
        opportunity_cost_per_month: monthly,
        first_blocked_at: first,
        months_blocked: months,
        cumulative_cost: f.status === "blocked" && monthly != null ? round2(monthly * months) : null,
      };
    });
}

function moneyFixture(params: Params): Money {
  const scope = (String(params.scope ?? "landscape") as Money["scope"]) || "landscape";
  const id = params.id ? String(params.id) : null;
  if (scope !== "landscape" && !id) throw new Refused(422, `scope=${scope} needs id`);
  let modules: string[] = landscape.cells.map((c) => c.module);
  if (scope === "object") modules = [id as string];
  if (scope === "wave") modules = waveById(id as string).modules;
  const features = modules.includes(MM) ? mmFeatures() : [];
  const unblocked = (mods: readonly string[]) => {
    const hit = features.filter((f) => f.status === "blocked" && f.modules.every((m) => mods.includes(m)));
    return { value: round2(hit.reduce((s, f) => s + (f.opportunity_cost_per_month ?? 0), 0)), features: hit.map((f) => f.feature).sort() };
  };
  const order = <T extends { value_unblocked_per_month: number | null; features: string[]; name: string }>(a: T, b: T) =>
    (b.value_unblocked_per_month ?? 0) - (a.value_unblocked_per_month ?? 0) || b.features.length - a.features.length || a.name.localeCompare(b.name);
  const objects = [...new Set(modules)].sort().map((m) => ({ id: m, name: m, value_unblocked_per_month: unblocked([m]).value, features: unblocked([m]).features }));
  const waves =
    scope === "landscape"
      ? (adminFixtureResponse("/migration/waves", {}) as { waves: { id: string; name: string; modules: string[] }[] }).waves.map((w) => ({ id: w.id, name: w.name, value_unblocked_per_month: unblocked(w.modules).value, features: unblocked(w.modules).features }))
      : [];
  const monthly = features.map((f) => f.opportunity_cost_per_month).filter((v): v is number => v != null);
  const cumulative = features.map((f) => f.cumulative_cost).filter((v): v is number => v != null);
  return {
    scope,
    id,
    as_of: NOW,
    currency: "ZAR",
    cost_model: true,
    features,
    totals: {
      opportunity_cost_per_month: round2(monthly.reduce((s, v) => s + v, 0)),
      cumulative_cost: round2(cumulative.reduce((s, v) => s + v, 0)),
      features_blocked: features.filter((f) => f.status === "blocked").length,
      features_degraded: features.filter((f) => f.status === "degraded").length,
    },
    ranking: { waves: waves.sort(order), objects: objects.sort(order) },
  };
}

// ── webhooks ─────────────────────────────────────────────────────────────────

const EVENTS: WebhookEvent[] = ["run.finished", "run.failed", "batch.waiting", "batch.approved", "batch.sent", "score.dropped", "breach.new", "config.drift", "certificate.signed"];

function hostOf(url: string): string {
  const u = url.trim();
  if (!u.startsWith("https://") || u.length < 12) throw new Refused(422, "url must be an https:// URL");
  return u.split("/")[2] ?? "?";
}

function webhookOf(id: string): Webhook {
  const w = st().webhooks.find((x) => x.id === id);
  if (!w) throw new Refused(404, "Webhook not found");
  return w;
}

function createWebhookFixture(b: Record<string, unknown>): unknown {
  const url = hostOf(String(b.url ?? ""));
  const events = (Array.isArray(b.events) ? (b.events as WebhookEvent[]) : []).filter(Boolean);
  if (!events.length) throw new Refused(422, "Choose at least one event.");
  const w: Webhook = { id: nextId("wh"), url, events: [...new Set(events)].sort(), active: b.active !== false, description: (b.description as string | null) ?? null, created_by: ME, created_at: NOW, updated_at: null };
  st().webhooks.push(w);
  st().deliveries[w.id] = [];
  return { ...w, secret: typeof b.secret === "string" && b.secret ? b.secret : `whsec_fixture_${w.id.replace(/\W/g, "")}_7d2f9c41` };
}

function patchWebhookFixture(id: string, b: Record<string, unknown>): Webhook {
  const w = webhookOf(id);
  const keys = Object.keys(b).filter((k) => b[k] !== undefined && b[k] !== null);
  if (!keys.length) throw new Refused(400, "No changes");
  if (typeof b.url === "string") w.url = hostOf(b.url);
  if (Array.isArray(b.events)) {
    if (!b.events.length) throw new Refused(422, "Choose at least one event.");
    w.events = [...new Set(b.events as WebhookEvent[])].sort();
  }
  if (typeof b.active === "boolean") w.active = b.active;
  if (typeof b.description === "string") w.description = b.description;
  w.updated_at = NOW;
  return clone(w);
}

function testWebhookFixture(id: string): unknown {
  webhookOf(id);
  const d: WebhookDelivery = { id: nextId("dlv"), event: "webhook.test", event_id: nextId("ev"), status: "delivered", attempts: 1, response_code: 200, error: null, created_at: NOW, last_attempt_at: NOW, next_attempt_at: null, delivered_at: NOW };
  (st().deliveries[id] ??= []).unshift(d);
  return { delivery_id: d.id, status: d.status, response_code: d.response_code, attempts: d.attempts, error: null };
}

// ── drift alerts ─────────────────────────────────────────────────────────────

const ALERTS: DriftAlert[] = [
  {
    id: "da-2",
    system_id: ECC.id,
    system_name: ECC.name,
    source: "config_sync",
    run_id: "cs-20261019",
    areas: [
      { area: "T006", added: 1, removed: 1, changed: 0 },
      { area: "T134", added: 1, removed: 0, changed: 0 },
    ],
    rules: [
      { check_id: "MM142", name: "Base unit of measure MEINS must reference a valid entry in T006" },
      { check_id: "MM003", name: "Material type is mandatory - determines procurement and storage behaviour" },
    ],
    objects: [MM],
    version_id: CURRENT_RUN,
    notified: 2,
    rescore_queued: true,
    created_at: "2026-10-19T22:14:00Z",
  },
  {
    id: "da-1",
    system_id: landscape.systems[1].id,
    system_name: landscape.systems[1].name,
    source: "config_load",
    run_id: "cl-s4-20261012",
    areas: [{ area: "T001W", added: 0, removed: 0, changed: 3 }],
    rules: [],
    objects: [],
    version_id: null,
    notified: 0,
    rescore_queued: false,
    created_at: "2026-10-12T06:40:00Z",
  },
];

// ── contracts ────────────────────────────────────────────────────────────────

function covers(c: { producer: string; quality_contract: Record<string, unknown> | null }, module: string): boolean {
  return c.producer === module || c.quality_contract?.module === module;
}

function breachesOf(t: ContractThresholds | null, module: string): ContractBreach[] {
  if (!t) return [];
  const cell = cellFor(module, ECC.id);
  const out: ContractBreach[] = [];
  if (t.min_score != null && (cell?.score == null || cell.score < t.min_score)) out.push({ metric: "score", threshold: t.min_score, actual: cell?.score ?? null });
  if (t.max_critical_breaches != null && cell && cell.breaches.length > t.max_critical_breaches) out.push({ metric: "critical_breaches", threshold: t.max_critical_breaches, actual: cell.breaches.length });
  for (const [dim, min] of Object.entries(t.dimensions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const v = cell?.dimensions[dim as DimensionKey];
    if (min != null && v != null && v < min) out.push({ metric: dim, threshold: min, actual: v });
  }
  return out;
}

function objectContractsFixture(module: string): { module: string; run_id: string | null; contracts: ObjectContract[]; breached: number; enforced_breached: number } {
  const cell = cellFor(module, ECC.id);
  const list = rolesContracts()
    .filter((c) => c.status === "active" && covers(c, module))
    .map((c) => {
      const e = st().enforcement[c.id] ?? { enforce: false, thresholds: null };
      const min = typeof c.quality_contract?.min_score === "number" ? (c.quality_contract.min_score as number) : undefined;
      const thresholds: ContractThresholds = e.thresholds ?? (min != null ? { min_score: min } : {});
      return { contract_id: c.id, name: c.name, producer: c.producer, consumer: c.consumer, enforce: e.enforce, thresholds, breaches: cell ? breachesOf(thresholds, module) : [] };
    });
  return { module, run_id: cell?.run_id ?? null, contracts: list, breached: list.filter((c) => c.breaches.length).length, enforced_breached: list.filter((c) => c.breaches.length && c.enforce).length };
}

/** The landscape with each cell's contract breaches, as the backend now adds them. */
export function withContractMarks(l: Landscape): Landscape {
  return {
    ...l,
    cells: l.cells.map((c) => {
      if (c.system_id !== ECC.id) return { ...c, contract_breaches: 0, enforced_contract_breaches: 0 };
      const o = objectContractsFixture(c.module);
      const all = o.contracts.reduce((n, x) => n + x.breaches.length, 0);
      const enforced = o.contracts.filter((x) => x.enforce).reduce((n, x) => n + x.breaches.length, 0);
      return { ...c, contract_breaches: all, enforced_contract_breaches: enforced };
    }),
  };
}

/** The receipt with its contract breaches, as the backend now adds them. */
export function receiptContractBreaches(module: string): (ContractBreach & { contract_id: string; name: string; enforce: boolean })[] {
  return objectContractsFixture(module).contracts.flatMap((c) => c.breaches.map((b) => ({ ...b, contract_id: c.contract_id, name: c.name, enforce: c.enforce })));
}

/** The baseline gate (POST /versions/{id}/baseline): refused while the run breaches an enforced contract. */
export function baselineGateFixture(runId: string, pinned: boolean, body: { force?: boolean; reason?: string | null } | undefined): void {
  if (!pinned || runId !== CURRENT_RUN) return;
  const breaches = landscape.cells
    .filter((c) => c.system_id === ECC.id)
    .flatMap((c) =>
      objectContractsFixture(c.module)
        .contracts.filter((x) => x.enforce)
        .flatMap((x) => x.breaches.map((b) => ({ ...b, contract_id: x.contract_id, name: x.name, enforce: true, module: c.module }))),
    );
  if (!breaches.length) return;
  if (!body?.force) throw new Refused(409, { detail: "This run breaches an enforced data contract; pin it with force and a reason.", breaches }, "This run breaches an enforced data contract; pin it with force and a reason.");
  if (!(body.reason ?? "").trim()) throw new Refused(422, "Say why the breached run is pinned anyway.");
}

// ── change log ───────────────────────────────────────────────────────────────

function changesFixture(versionId: string): VersionChanges {
  const idx = runs.findIndex((r) => r.id === versionId);
  if (idx < 0) throw new Refused(404, "Version not found");
  if (idx === 0) {
    const tables = [
      { table: "MARA", mode: "change_date", rows_read: 1840, rows_total: 61816, inserted: 112, updated: 1604, deleted: 9, unchanged: 60091, duration_s: 14.2 },
      { table: "MARC", mode: "full", rows_read: 148230, rows_total: 148230, inserted: 210, updated: 3120, deleted: 4, unchanged: 144896, duration_s: 96.4 },
      { table: "MBEW", mode: "change_date", rows_read: 2210, rows_total: 96104, inserted: 40, updated: 2101, deleted: 0, unchanged: 93963, duration_s: 11.8 },
    ];
    const sum = (k: "inserted" | "updated" | "deleted" | "unchanged") => tables.reduce((s, t) => s + t[k], 0);
    return {
      version_id: versionId,
      delta: { baseline_version_id: runs[1].id, since: "20261009" },
      tables,
      totals: { rows_read: tables.reduce((s, t) => s + t.rows_read, 0), rows_total: tables.reduce((s, t) => s + t.rows_total, 0), inserted: sum("inserted"), updated: sum("updated"), deleted: sum("deleted"), unchanged: sum("unchanged"), changed: sum("inserted") + sum("updated") + sum("deleted") },
    };
  }
  const tables = [
    { table: "MARA", mode: "full", rows_read: 61700, rows_total: 61700, inserted: null, updated: null, deleted: null, unchanged: null, duration_s: 41.0 },
    { table: "MARC", mode: "full", rows_read: 148020, rows_total: 148020, inserted: null, updated: null, deleted: null, unchanged: null, duration_s: 95.2 },
    { table: "MBEW", mode: "full", rows_read: 96010, rows_total: 96010, inserted: null, updated: null, deleted: null, unchanged: null, duration_s: 60.7 },
  ];
  return {
    version_id: versionId,
    delta: null,
    tables,
    totals: { rows_read: tables.reduce((s, t) => s + t.rows_read, 0), rows_total: tables.reduce((s, t) => s + t.rows_total, 0), inserted: null, updated: null, deleted: null, unchanged: null, changed: null },
  };
}

// ── routing ──────────────────────────────────────────────────────────────────

/** A step 9 read, or NONE_STEP9 for a path this file does not own. */
export function step9Read(path: string, params: Params): unknown {
  if (path === "/simulate/fix/top") return topFixture(params);
  const cert = /^\/migration\/waves\/([^/]+)\/certificate$/.exec(path);
  if (cert) return certificatesFixture(decodeURIComponent(cert[1]));
  if (path === "/impact/money") return moneyFixture(params);
  if (path === "/webhooks") return { webhooks: clone(st().webhooks) };
  if (path === "/webhooks/events") return { events: [...EVENTS] };
  const dl = /^\/webhooks\/([^/]+)\/deliveries$/.exec(path);
  if (dl) {
    const id = decodeURIComponent(dl[1]);
    webhookOf(id);
    const status = params.status ? String(params.status) : null;
    return { deliveries: clone((st().deliveries[id] ?? []).filter((d) => !status || d.status === status)) };
  }
  if (path === "/settings/automation") return clone(st().automation);
  if (path === "/config/drift/alerts") return { alerts: clone(ALERTS.slice(0, Number(params.limit ?? 50))) };
  const oc = /^\/objects\/([^/]+)\/contracts$/.exec(path);
  if (oc) return objectContractsFixture(decodeURIComponent(oc[1]));
  const cb = /^\/contracts\/([^/]+)\/breaches$/.exec(path);
  if (cb) {
    const id = decodeURIComponent(cb[1]);
    const c = rolesContracts().find((x) => x.id === id);
    if (!c) throw new Refused(404, "Contract not found");
    const e = st().enforcement[id] ?? { enforce: false, thresholds: null };
    const current = landscape.cells.filter((cell) => cell.system_id === ECC.id && covers(c, cell.module)).flatMap((cell) => breachesOf(e.thresholds, cell.module).map((b) => ({ ...b, contract_id: id, name: c.name, enforce: e.enforce, module: cell.module, run_id: cell.run_id, system_id: cell.system_id })));
    return { contract_id: id, name: c.name, status: c.status, enforce: e.enforce, thresholds: e.thresholds ?? {}, current, history: [] };
  }
  const ch = /^\/versions\/([^/]+)\/changes$/.exec(path);
  if (ch) return changesFixture(decodeURIComponent(ch[1]));
  return NONE_STEP9;
}

/** A step 9 write, or NONE_STEP9 for a path this file does not own. */
export function step9Write(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && path === "/simulate/fix") return simulateFixture(b as unknown as SimulateBody);
  const cert = /^\/migration\/waves\/([^/]+)\/certificate$/.exec(path);
  if (method === "POST" && cert) return issueFixture(decodeURIComponent(cert[1]));
  const sign = /^\/migration\/waves\/([^/]+)\/certificate\/([^/]+)\/sign$/.exec(path);
  if (method === "POST" && sign) return signFixture(decodeURIComponent(sign[1]), decodeURIComponent(sign[2]), b as { statement?: string | null });
  if (method === "POST" && path === "/webhooks") return createWebhookFixture(b);
  const wh = /^\/webhooks\/([^/]+)$/.exec(path);
  if (wh && method === "PATCH") return patchWebhookFixture(decodeURIComponent(wh[1]), b);
  if (wh && method === "DELETE") {
    const id = decodeURIComponent(wh[1]);
    webhookOf(id);
    st().webhooks = st().webhooks.filter((x) => x.id !== id);
    delete st().deliveries[id];
    return undefined;
  }
  const test = /^\/webhooks\/([^/]+)\/test$/.exec(path);
  if (method === "POST" && test) return testWebhookFixture(decodeURIComponent(test[1]));
  if (method === "PUT" && path === "/settings/automation") {
    const a = st().automation;
    const next = b as Partial<AutomationSettings>;
    st().automation = { drift_alerts: { ...a.drift_alerts, ...(next.drift_alerts ?? {}) }, rule_mining: { ...a.rule_mining, ...(next.rule_mining ?? {}) }, score_drop: { ...a.score_drop, ...(next.score_drop ?? {}) } };
    return clone(st().automation);
  }
  const enf = /^\/contracts\/([^/]+)\/enforcement$/.exec(path);
  if (method === "PUT" && enf) {
    const id = decodeURIComponent(enf[1]);
    if (!rolesContracts().some((c) => c.id === id)) throw new Refused(404, "Contract not found");
    const thresholds = (b.thresholds as ContractThresholds | null | undefined) ?? null;
    st().enforcement[id] = { enforce: Boolean(b.enforce), thresholds };
    return { id, enforce: Boolean(b.enforce), thresholds };
  }
  return NONE_STEP9;
}

/** The certificate PDF in fixture mode: a small text stand-in, or null for a path this file does not own. */
export function step9Download(path: string): { name: string; text: string } | null {
  const m = /^\/migration\/waves\/([^/]+)\/certificate\/([^/]+)\/pdf$/.exec(path);
  if (!m) return null;
  const waveId = decodeURIComponent(m[1]);
  const cert = (st().certs[waveId] ?? []).find((c) => c.id === decodeURIComponent(m[2]));
  if (!cert) throw new Refused(404, "Certificate file not found.");
  const w = waveById(waveId);
  return { name: `readiness_certificate_${w.name.replace(/[^A-Za-z0-9]+/g, "_")}_v${cert.version}.pdf`, text: `Fixture copy of the readiness certificate of ${w.name}, version ${cert.version}, SHA-256 ${cert.sha256}.\n` };
}
