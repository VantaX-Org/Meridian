import type {
  ActivityEntry, ApplyPlan, ApplyRow, AssignmentTemplate, BalanceMove, BalancePlan, BulkResult, BundleDiff, Comment, Contract, ContractDetail, Delegation, DryRun, EscalationStep, Gap, RelatedOut,
  ShareLink, SliceKind, Subscription, TemplateOut, WatchEvent, WatchState, WaveGate,
} from "../roles";
import landscapeJson from "./landscape.json";
import stewardJson from "./stewardship.json";
import roleActions from "./role-actions.json";

/**
 * Fixture answers for the step 6c verbs (`?fixture=1`): comments and mentions, watches, subscriptions, delegations,
 * the escalation chain, contracts, workload balancing, wave gates, the extraction dry run, share links, the
 * configuration bundle, view as, bulk rules, the stewardship template and related objects. One in-memory state,
 * reset by resetRolesFixture (index.ts resetWorkFixture calls it). The numbers follow the demo tenant of the other
 * fixtures: Material master on ECC production, 3,640 records failing MM014, the waves w-1 to w-3.
 */

export const NONE_ROLES = Symbol("none");
type Params = Record<string, unknown>;

class Refused extends Error {
  response: { status: number; data: { detail: string } };
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.response = { status, data: { detail } };
  }
}

const NOW = "2026-10-20T08:00:00Z";
const ME = "u-me";
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const PEOPLE: Record<string, string> = { "u-me": "Demo user", "u-rg": "R. Govender", "u-an": "A. Naidoo", "u-tm": "T. Mokoena", "u-pk": "P. Khumalo", "u-sd": "S. Dlamini" };
const HANDLES: Record<string, string> = { "demo.user": "u-me", "r.govender": "u-rg", "a.naidoo": "u-an", "t.mokoena": "u-tm", "p.khumalo": "u-pk", "s.dlamini": "u-sd" };
const EVENTS: [string, string][] = [
  ["mention", "Someone mentions you in a comment"], ["comment", "A comment on something you watch"], ["run_finished", "A run finishes on an object you watch"],
  ["score_dropped", "The score of an object you watch drops"], ["critical_breach", "A new critical breach on an object or rule you watch"],
  ["batch_waiting", "A fix batch you watch waits for approval"], ["delegated", "Work routed to you while someone is out of office"],
];
/** Fixture module ids are the prototype's; the relationship map speaks the API's. */
const API_ID: Record<string, string> = { vendor_master: "accounts_payable", customer_master: "accounts_receivable", gl_accounts: "fi_gl", purchasing: "mm_purchasing", sales_orders: "sd_sales_orders" };
const FIX_ID: Record<string, string> = Object.fromEntries(Object.entries(API_ID).map(([a, b]) => [b, a]));
const LABEL: Record<string, string> = Object.fromEntries((landscapeJson as { objects: { module: string; label: string }[] }).objects.map((o) => [o.module, o.label]));
/** Open critical failures in the current state, per fixture module (Material master: MM014's 3,640). */
const CRITICALS: Record<string, number> = { material_master: 3640, business_partner: 1210, vendor_master: 402, customer_master: 388, asset_accounting: 96, controlling: 140 };

const label = (m: string): string => LABEL[m] ?? LABEL[FIX_ID[m] ?? ""] ?? m.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface State {
  seq: number;
  comments: Comment[];
  watches: WatchState[];
  subs: Record<string, boolean>;
  mentions: number;
  delegations: Delegation[];
  chain: EscalationStep[];
  contracts: Contract[];
  versions: Record<string, ContractDetail["versions"]>;
  gates: Record<string, WaveGate["gate"]>;
  links: ShareLink[];
  template: AssignmentTemplate;
  templateSaved: boolean;
  owners: Record<string, string>;
  stewards: Record<string, string>;
  viewAs: string | null;
  lastExport: { path: string; body: unknown } | null;
  audit: { action: string; at: string }[];
}

function build(): State {
  const template = JSON.parse(JSON.stringify(stewardJson.template)) as AssignmentTemplate;
  return {
    seq: 0,
    comments: [
      { id: "cm-1", target_kind: "record", target_id: "material_master:MATNR=000000000000000100", body: "Check the unit with purchasing before Friday, @a.naidoo.", author_id: "u-rg", author_label: "R. Govender", mentions: ["u-an"], created_at: "2026-10-19T09:12:00Z", mine: false },
      { id: "cm-2", target_kind: "rule", target_id: "MM014", body: "Most of these are KG against PC in plant 3000.", author_id: "u-an", author_label: "A. Naidoo", mentions: [], created_at: "2026-10-18T14:40:00Z", mine: false },
    ],
    watches: [{ target_kind: "object", target_id: `${ECC}:material_master`, watching: true, events: [] }],
    subs: {},
    mentions: 2,
    delegations: [{ id: "dl-1", from_user_id: "u-tm", to_user_id: ME, from_name: "T. Mokoena", to_name: "Demo user", starts_on: "2026-10-19", ends_on: "2026-10-30", reason: "Annual leave", state: "active" }],
    chain: [{ level: 1, after_minutes: 240, target: "team_lead", user_id: null, user_name: null }],
    contracts: [
      { id: "ct-1", name: "Material master to S/4HANA", description: "What the migration load needs from Material master.", producer: "material_master", consumer: "S/4HANA migration", status: "active", version: 2, quality_contract: { module: "material_master", min_score: 85 }, freshness_contract: { max_age_days: 7 }, created_by: "u-rg", latest_compliant: false, last_checked: "2026-10-16T05:20:00Z" },
      { id: "ct-2", name: "Vendor bank data for payments", description: null, producer: "vendor_master", consumer: "Accounts payable", status: "draft", version: 1, quality_contract: { module: "vendor_master", min_score: 90 }, freshness_contract: null, created_by: ME, latest_compliant: null, last_checked: null },
    ],
    versions: { "ct-1": [{ version: 1, snapshot: { name: "Material master to S/4HANA", status: "active", quality_contract: { min_score: 80 } }, note: "Raised the bar for mock load 2", created_by: "R. Govender", created_at: "2026-09-01T08:00:00Z" }] },
    gates: {
      "w-1": { min_score: 85, zero_criticals: true, contracts_met: true, configured: true, updated_by: "R. Govender", updated_at: "2026-10-12T10:00:00Z" },
      "w-2": { min_score: 80, zero_criticals: true, contracts_met: false, configured: true, updated_by: "R. Govender", updated_at: "2026-10-12T10:00:00Z" },
    },
    links: [
      { id: "sl-1", route: "/v2/o/ecc-production/material-master", state: { tab: "rules" }, role: "viewer", label: "Material master rules for the audit", created_by: ME, created_by_label: "Demo user", created_at: "2026-10-18T08:00:00Z", expires_at: "2026-10-25T08:00:00Z", revoked_at: null, last_opened_at: "2026-10-19T11:00:00Z", open_count: 3, state_word: "active" },
      { id: "sl-2", route: "/v2", state: {}, role: "viewer", label: null, created_by: "u-rg", created_by_label: "R. Govender", created_at: "2026-09-01T08:00:00Z", expires_at: "2026-09-08T08:00:00Z", revoked_at: null, last_opened_at: null, open_count: 0, state_word: "expired" },
    ],
    template,
    templateSaved: false,
    owners: { material_master: "u-rg", accounts_payable: "u-tm", business_partner: "u-tm", fi_gl: "u-pk", asset_accounting: "u-pk" },
    stewards: { "material_master|plant|3000": "u-an", "material_master|plant|1000": "u-me" },
    viewAs: null,
    lastExport: null,
    audit: [],
  };
}

let S: State | null = null;
const st = (): State => (S ??= build());
export function resetRolesFixture(): void {
  S = null;
}
/** Test seam: what the last export POSTed. */
export const lastRolesExport = (): State["lastExport"] => st().lastExport;
export const rolesAudit = (): State["audit"] => st().audit;
const nextId = (p: string): string => `${p}-${++st().seq + 100}`;
const audit = (action: string): void => void st().audit.push({ action, at: NOW });
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

// ── derived answers ──────────────────────────────────────────────────────────

const ACTIVE: Record<SliceKind, string[]> = { plant: ["1000", "3000"], company_code: ["1000"], sales_org: ["1000"], purchasing_org: ["1000"], none: [] };
const values = (kind: SliceKind): string[] => (kind === "none" ? ["*"] : ACTIVE[kind]);

export function templatePlan(s: State, modules?: string[]): ApplyPlan {
  const owners: ApplyRow[] = [];
  const stewards: ApplyRow[] = [];
  for (const [m, o] of Object.entries(s.template.objects).sort(([a], [b]) => a.localeCompare(b))) {
    if (modules && !modules.includes(m)) continue;
    if (o.owner_user_id) {
      const before = s.owners[m] ?? null;
      owners.push({ module: m, change: before === o.owner_user_id ? "same" : before ? "change" : "add", before, after: o.owner_user_id });
    }
    for (const v of values(o.slice)) {
      const after = o.slice_stewards?.[v] ?? o.steward_user_id;
      if (!after) continue;
      const before = s.stewards[`${m}|${o.slice}|${v}`] ?? null;
      stewards.push({ module: m, slice_kind: o.slice, slice_value: v, change: before === after ? "same" : before ? "change" : "add", before, after });
    }
  }
  const all = [...owners, ...stewards];
  return { dry_run: true, owners, stewards, totals: { add: all.filter((r) => r.change === "add").length, change: all.filter((r) => r.change === "change").length, same: all.filter((r) => r.change === "same").length } };
}

export function templateGaps(s: State): Gap[] {
  const measured = (landscapeJson as { objects: { module: string }[] }).objects.map((o) => API_ID[o.module] ?? o.module);
  const out: Gap[] = [];
  for (const m of [...new Set(measured)].sort()) {
    if (!s.owners[m]) out.push({ module: m, label: label(m), gap: "no_owner", slice_kind: null, slice_value: null, sentence: "No owner" });
    const kind = s.template.objects[m]?.slice ?? "none";
    const whole = Object.keys(s.stewards).some((k) => k.startsWith(`${m}|`) && k.endsWith("|*"));
    for (const v of values(kind)) {
      if (whole || s.stewards[`${m}|${kind}|${v}`]) continue;
      const word = { company_code: "company code", plant: "plant", sales_org: "sales organisation", purchasing_org: "purchasing organisation", none: "whole object" }[kind];
      out.push({ module: m, label: label(m), gap: "no_steward", slice_kind: kind, slice_value: v, sentence: v === "*" ? "No steward" : `No steward for ${word} ${v}` });
    }
  }
  return out;
}

export function relatedFixture(module: string): RelatedOut {
  const api = API_ID[module] ?? module;
  const rel = (stewardJson.relationships as Record<string, Record<string, "upstream" | "downstream" | "shared-reference">>)[api] ?? {};
  const tiers = stewardJson.tiers as Record<string, number>;
  const order = { upstream: 0, "shared-reference": 1, downstream: 2 };
  const related = Object.entries(rel)
    .map(([m, relation]) => {
      const fx = FIX_ID[m] ?? m;
      return { module: fx, label: label(fx), relation, tier: tiers[m] ?? null, open_criticals: CRITICALS[fx] ?? 0 };
    })
    .sort((a, b) => order[a.relation] - order[b.relation] || (a.tier ?? 9) - (b.tier ?? 9) || a.module.localeCompare(b.module));
  const up = related.filter((r) => r.relation === "upstream" && r.open_criticals > 0).sort((a, b) => b.open_criticals - a.open_criticals || a.module.localeCompare(b.module))[0];
  return { module, tier: tiers[api] ?? null, related, fix_hint: up ? { module: up.module, failures: up.open_criticals, sentence: `Fix ${up.label} first: ${up.open_criticals.toLocaleString("en-US")} upstream failures` } : null };
}

function gateOf(waveId: string, name: string, modules: string[], s: State): WaveGate {
  const gate = s.gates[waveId] ?? { min_score: null, zero_criticals: true, contracts_met: false, configured: false, updated_by: null, updated_at: null };
  const cells = (landscapeJson as { cells: { system_id: string; module: string; score: number | null; breaches: string[] }[] }).cells.filter((c) => c.system_id === ECC && modules.includes(c.module));
  const checks: WaveGate["status"]["checks"] = [];
  if (gate.min_score !== null) {
    const below = cells.filter((c) => c.score !== null && c.score < (gate.min_score ?? 0)).map((c) => label(c.module));
    const missing = modules.filter((m) => !cells.some((c) => c.module === m)).map(label);
    const ok = !below.length && !missing.length;
    checks.push({ key: "min_score", label: `Every object at ${gate.min_score.toFixed(1)} or more`, passed: ok, detail: ok ? `Every object is at or above ${gate.min_score.toFixed(1)}.` : [below.length ? `below ${gate.min_score.toFixed(1)}: ${below.join(", ")}` : "", missing.length ? `not measured: ${missing.join(", ")}` : ""].filter(Boolean).join("; ") });
  }
  if (gate.zero_criticals) {
    const crit = cells.filter((c) => c.breaches.length).map((c) => label(c.module));
    checks.push({ key: "zero_criticals", label: "No critical rule over tolerance", passed: !crit.length, detail: crit.length ? `Capped by a critical rule: ${crit.join(", ")}` : "No object is capped by a critical rule." });
  }
  if (gate.contracts_met) {
    const rel = s.contracts.filter((c) => c.status === "active" && modules.includes(c.producer));
    const broken = rel.filter((c) => c.latest_compliant !== true).map((c) => c.name);
    checks.push({ key: "contracts_met", label: "Data contracts met", passed: !broken.length, detail: !rel.length ? "No active contract names these objects." : broken.length ? `Not met or never checked: ${broken.join(", ")}` : `All ${rel.length} contracts met.` });
  }
  return { wave_id: waveId, name, modules, gate, status: { passed: checks.every((c) => c.passed), checks }, signed_off: false, certificate_href: `/api/v1/migration/waves/${waveId}/certificate` };
}

const WAVES: [string, string, string[]][] = [
  ["w-1", "Wave 1: finance foundations", ["gl_accounts", "asset_accounting", "controlling", "vendor_master"]],
  ["w-2", "Wave 2: master data", ["material_master", "business_partner", "customer_master"]],
  ["w-3", "Wave 3: operations", ["purchasing", "sales_orders", "plant_maintenance"]],
];

/** The balance plan of the demo tenant's stewards: A. Naidoo carries 214, Demo user 38, R. Govender 12. */
function balancePlan(by: BalancePlan["by"]): BalancePlan {
  const before = { "u-an": 214, "u-me": 38, "u-rg": 12 };
  const moves: BalanceMove[] =
    by === "object"
      ? [{ from: "u-an", to: "u-rg", module: "mm_purchasing", count: 86, issue_ids: [] }]
      : by === "slice"
        ? [{ from: "u-an", to: "u-me", module: "material_master", count: 64, issue_ids: [] }]
        : [
            { from: "u-an", to: "u-rg", module: "material_master", count: 76, issue_ids: [] },
            { from: "u-an", to: "u-me", module: "material_master", count: 50, issue_ids: [] },
          ];
  const after: Record<string, number> = { ...before };
  for (const m of moves) {
    if (m.from) after[m.from] -= m.count;
    after[m.to] += m.count;
  }
  return { by, before, after, moves, moved: moves.reduce((n, m) => n + m.count, 0), people: Object.keys(before).map((id) => ({ id, name: PEOPLE[id] })) };
}

// ── reads ────────────────────────────────────────────────────────────────────

export function rolesFixtureResponse(path: string, params: Params): unknown {
  const s = st();
  if (path === "/comments") {
    const kind = str(params.target_kind);
    const id = str(params.target_id);
    return { target_kind: kind, target_id: id, comments: s.comments.filter((c) => c.target_kind === kind && c.target_id === id) };
  }
  if (path === "/comments/mentions/unread") return { count: s.mentions };
  if (path === "/watches") {
    const hit = s.watches.find((w) => w.target_kind === params.target_kind && w.target_id === params.target_id);
    return hit ?? { target_kind: params.target_kind, target_id: params.target_id, watching: false, events: [] };
  }
  if (path === "/me/subscriptions") return { events: EVENTS.map<Subscription>(([event, l]) => ({ event, label: l, enabled: s.subs[event] ?? true, default: true })) };
  const act = /^\/people\/([^/]+)\/activity$/.exec(path);
  if (act) {
    const entries: ActivityEntry[] = [
      { id: "a-1", action: "decide", entity_type: "work", entity_id: "MM014", method: "POST", path: "/api/v1/work/decide", status_code: 200, created_at: "2026-10-16T08:55:00Z" },
      { id: "a-2", action: "comment.create", entity_type: "comment:rule", entity_id: "MM014", method: "POST", path: "/api/v1/comments", status_code: 201, created_at: "2026-10-15T13:10:00Z" },
      { id: "a-3", action: "approve", entity_type: "remediation", entity_id: "B-238", method: "POST", path: "/api/v1/remediation/batches/B-238/approve", status_code: 200, created_at: "2026-10-14T09:02:00Z" },
    ];
    return { user_id: decodeURIComponent(act[1]), entries };
  }
  if (path === "/delegations/mine") return { away: s.delegations.filter((d) => d.from_user_id === ME && d.state !== "revoked"), covering: s.delegations.filter((d) => d.to_user_id === ME && d.state !== "revoked") };
  if (path === "/delegations") return { delegations: s.delegations };
  if (path === "/triage/escalation-chain") return { steps: s.chain };
  if (path === "/contracts") return { contracts: s.contracts, total: s.contracts.length };
  const cd = /^\/contracts\/([^/]+)\/detail$/.exec(path);
  if (cd) {
    const c = s.contracts.find((x) => x.id === decodeURIComponent(cd[1]));
    if (!c) throw new Refused(404, "Contract not found");
    const breaches = c.latest_compliant === false ? [{ version_id: "d3229ded-0708-4967-9dfb-1b7f4fada953", violations: [{ dimension: "validity", expected: 85, actual: 66 }], recorded_at: "2026-10-16T05:20:00Z" }] : [];
    return { contract: c, versions: s.versions[c.id] ?? [], breaches, checks: c.last_checked ? 4 : 0 } satisfies ContractDetail;
  }
  if (path === "/migration/waves/gates") return { gates: WAVES.map(([id, name, mods]) => gateOf(id, name, mods, s)) };
  if (path === "/share-links") return { links: params.all ? s.links : s.links.filter((l) => l.created_by === ME) };
  const res = /^\/share-links\/resolve\/([^/]+)$/.exec(path);
  if (res) {
    if (decodeURIComponent(res[1]) === "expired") throw new Refused(410, "This link was expired. Ask whoever shared it for a new one.");
    return { id: "sl-1", route: "/v2/o/ecc-production/material-master", state: { tab: "rules" }, role: "viewer", label: "Material master rules for the audit", expires_at: "2026-10-25T08:00:00Z", shared_by: "Demo user" };
  }
  if (path === "/admin/assignment-template") return { template: s.template, saved: s.templateSaved, updated_by: s.templateSaved ? "Demo user" : null, updated_at: s.templateSaved ? NOW : null, active_slices: ACTIVE, labels: Object.fromEntries(Object.keys(s.template.objects).map((m) => [m, label(m)])) } satisfies TemplateOut;
  if (path === "/admin/assignment-template/gaps") return { objects: 15, gaps: templateGaps(s), based_on: "measured objects" };
  const rel = /^\/objects\/([^/]+)\/related$/.exec(path);
  if (rel) return relatedFixture(decodeURIComponent(rel[1]));
  return NONE_ROLES;
}

// ── writes ───────────────────────────────────────────────────────────────────

export function rolesFixtureWrite(method: string, path: string, body: unknown, params: Params): unknown {
  const s = st();
  const b = (body ?? {}) as Record<string, unknown>;
  if (s.viewAs && !(path === "/admin/view-as")) throw new Refused(403, `You are viewing as ${s.viewAs}: nothing can be changed until you stop.`);
  if (method === "POST" && path === "/comments") {
    const text = str(b.body).trim();
    if (!text) throw new Refused(422, "Write something before posting.");
    const handles = [...text.matchAll(/(?<![\w.])@([A-Za-z0-9][\w.-]{0,63})/g)].map((m) => HANDLES[m[1].replace(/[.-]+$/, "").toLowerCase()]).filter(Boolean);
    const mentions = [...new Set([...((b.mentions as string[]) ?? []), ...handles])].filter((u) => PEOPLE[u]);
    const c: Comment = { id: nextId("cm"), target_kind: b.target_kind as Comment["target_kind"], target_id: str(b.target_id), body: text, author_id: ME, author_label: "Demo user", mentions, created_at: NOW, mine: true };
    s.comments.push(c);
    audit("comment.create");
    return c;
  }
  const dc = /^\/comments\/([^/]+)$/.exec(path);
  if (method === "DELETE" && dc) {
    const c = s.comments.find((x) => x.id === decodeURIComponent(dc[1]));
    if (!c) throw new Refused(404, "Comment not found");
    if (c.author_id !== ME) throw new Refused(403, "Only the author can remove a comment.");
    s.comments = s.comments.filter((x) => x !== c);
    return undefined;
  }
  if (method === "PUT" && path === "/watches") {
    const w: WatchState = { target_kind: b.target_kind as WatchState["target_kind"], target_id: str(b.target_id), watching: true, events: (b.events as WatchEvent[]) ?? [] };
    s.watches = [...s.watches.filter((x) => !(x.target_kind === w.target_kind && x.target_id === w.target_id)), w];
    audit("watch.start");
    return w;
  }
  if (method === "DELETE" && path === "/watches") {
    s.watches = s.watches.filter((x) => !(x.target_kind === params.target_kind && x.target_id === params.target_id));
    return undefined;
  }
  if (method === "PUT" && path === "/me/subscriptions") {
    Object.assign(s.subs, b);
    return rolesFixtureResponse("/me/subscriptions", {});
  }
  if (method === "POST" && path === "/delegations") {
    const to = str(b.to_user_id);
    if (!PEOPLE[to]) throw new Refused(404, "Both people must be active users of this tenant.");
    if (to === "u-sd") throw new Refused(422, "The person covering cannot approve, so approvals would stall. Choose someone who may approve.");
    if (str(b.ends_on) < str(b.starts_on)) throw new Refused(422, "The last day comes before the first.");
    if (s.delegations.some((d) => d.from_user_id === ME && d.state !== "revoked" && d.starts_on <= str(b.ends_on) && d.ends_on >= str(b.starts_on))) throw new Refused(409, "An out-of-office delegation already covers some of those days.");
    const d: Delegation = { id: nextId("dl"), from_user_id: ME, to_user_id: to, from_name: "Demo user", to_name: PEOPLE[to], starts_on: str(b.starts_on), ends_on: str(b.ends_on), reason: (b.reason as string) ?? null, state: str(b.starts_on) <= "2026-10-20" ? "active" : "scheduled" };
    s.delegations.push(d);
    audit("delegation.create");
    return d;
  }
  const dd = /^\/delegations\/([^/]+)$/.exec(path);
  if (method === "DELETE" && dd) {
    const d = s.delegations.find((x) => x.id === decodeURIComponent(dd[1]));
    if (!d) throw new Refused(404, "Delegation not found");
    d.state = "revoked";
    audit("delegation.revoke");
    return undefined;
  }
  if (method === "PUT" && path === "/triage/escalation-chain") {
    const steps = (b.steps as EscalationStep[]) ?? [];
    if (steps.some((x, i) => x.level !== i + 1)) throw new Refused(422, "Levels must run 1, 2, 3 in order with no gap.");
    if (steps.some((x, i) => i > 0 && x.after_minutes <= steps[i - 1].after_minutes)) throw new Refused(422, "Each level must come later than the one before it.");
    if (steps.some((x) => x.target === "user" && !x.user_id)) throw new Refused(422, `Choose the person to notify.`);
    s.chain = steps.map((x) => ({ ...x, user_name: x.user_id ? PEOPLE[x.user_id] ?? null : null }));
    audit("escalation_chain.update");
    return { steps: s.chain };
  }
  if (method === "POST" && path === "/contracts") {
    if (!str(b.name).trim()) throw new Refused(422, "Name the contract.");
    const c: Contract = { id: nextId("ct"), name: str(b.name), description: (b.description as string) ?? null, producer: str(b.producer), consumer: str(b.consumer), status: "draft", version: 1, quality_contract: (b.quality_contract as Record<string, unknown>) ?? null, freshness_contract: null, created_by: ME, latest_compliant: null, last_checked: null };
    s.contracts.push(c);
    return { id: c.id, status: "draft" };
  }
  const cu = /^\/contracts\/([^/]+)(\/activate|\/revise)?$/.exec(path);
  if (cu) {
    const c = s.contracts.find((x) => x.id === decodeURIComponent(cu[1]));
    if (!c) throw new Refused(404, "Contract not found");
    if (method === "PUT" && !cu[2]) {
      if (c.status !== "draft" && c.status !== "pending_approval") throw new Refused(400, "Only draft or pending_approval contracts can be updated");
      Object.assign(c, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
      return c;
    }
    if (method === "PUT" && cu[2] === "/activate") {
      if (c.created_by === ME) throw new Refused(403, "Four-eyes: the contract author cannot activate it.");
      if (c.status !== "pending_approval") throw new Refused(400, `Contract must be in pending_approval status to activate (current: ${c.status})`);
      c.status = "active";
      return { id: c.id, status: "active" };
    }
    if (method === "POST" && cu[2] === "/revise") {
      if (c.status === "draft" || c.status === "pending_approval") throw new Refused(409, "This contract is already a draft; edit it directly.");
      (s.versions[c.id] ??= []).unshift({ version: c.version, snapshot: { name: c.name, status: c.status, quality_contract: c.quality_contract }, note: (b.note as string) ?? null, created_by: "Demo user", created_at: NOW });
      c.version += 1;
      c.status = "draft";
      audit("contract.revise");
      return { id: c.id, version: c.version, status: "draft" };
    }
  }
  if (method === "POST" && path === "/people/balance/plan") return balancePlan((b.by as BalancePlan["by"]) ?? "owner");
  if (method === "POST" && path === "/people/balance/apply") {
    const moves = (b.moves as BalanceMove[]) ?? [];
    audit("balance.apply");
    return { moved: moves.reduce((n, m) => n + m.count, 0), skipped: 0, action_id: nextId("act") };
  }
  const gate = /^\/migration\/waves\/([^/]+)\/gate$/.exec(path);
  if (method === "PUT" && gate) {
    const id = decodeURIComponent(gate[1]);
    const w = WAVES.find(([wid]) => wid === id);
    if (!w) throw new Refused(404, "Wave not found.");
    const min = b.min_score === null || b.min_score === undefined ? null : Number(b.min_score);
    if (min !== null && (Number.isNaN(min) || min < 0 || min > 100)) throw new Refused(422, "The minimum score runs from 0 to 100.");
    s.gates[id] = { min_score: min, zero_criticals: Boolean(b.zero_criticals), contracts_met: Boolean(b.contracts_met), configured: true, updated_by: "Demo user", updated_at: NOW };
    audit("wave_gate.update");
    return gateOf(id, w[1], w[2], s);
  }
  const dl = /^\/systems\/([^/]+)\/downloads$/.exec(path);
  if (method === "POST" && dl && b.dry_run) {
    const objects = (b.objects as string[]) ?? [];
    const TABLES: Record<string, [string, number | null][]> = { material_master: [["MARA", 61816], ["MARC", 148202], ["MAKT", 61816], ["MARM", 92310], ["MBEW", 148202]], business_partner: [["BUT000", 41208], ["BUT020", 39120], ["ADRC", null]] };
    const tables = objects.flatMap((o) => (TABLES[o] ?? [[`${o.toUpperCase().slice(0, 4)}`, null]]).map(([table, rows]) => ({ table, objects: [o], rows })));
    const total = tables.reduce((n, t) => n + (t.rows ?? 0), 0);
    return { dry_run: true, objects, tables, total_rows: total, unknown_tables: tables.filter((t) => t.rows === null).length, seconds: Math.round(total / 4210.5), rate: 4210.5, rate_basis: "measured", delta: objects.includes("material_master") ? { available: true, reason: "Only records that SAP's change documents name since the last download are read; tables without change documents are read in full." } : { available: false, reason: "No earlier download of these objects with this scope to build on." } } satisfies DryRun;
  }
  if (method === "POST" && dl && b.delta) return { job_id: nextId("dl"), status: "queued", delta: true };
  if (method === "POST" && path === "/share-links") {
    const token = `fx${nextId("tok")}`;
    const link: ShareLink = { id: nextId("sl"), route: str(b.route), state: (b.state as Record<string, string>) ?? {}, role: "viewer", label: (b.label as string) ?? null, created_by: ME, created_by_label: "Demo user", created_at: NOW, expires_at: "2026-10-27T08:00:00Z", revoked_at: null, last_opened_at: null, open_count: 0, state_word: "active" };
    if (!/^\/v2/.test(link.route)) throw new Refused(422, "Only a page of the new interface (/v2...) can be shared.");
    s.links.unshift(link);
    audit("share_link.create");
    return { ...link, token, url: `/v2/share/${token}` };
  }
  const rl = /^\/share-links\/([^/]+)$/.exec(path);
  if (method === "DELETE" && rl) {
    const l = s.links.find((x) => x.id === decodeURIComponent(rl[1]));
    if (!l) throw new Refused(404, "Share link not found");
    l.revoked_at = NOW;
    l.state_word = "revoked";
    audit("share_link.revoke");
    return undefined;
  }
  if (method === "POST" && path === "/admin/config-bundle/import") {
    if ((b as { format?: string }).format !== "meridian.tenant-config") throw new Refused(422, "The format must be meridian.tenant-config.");
    const diff: BundleDiff = {
      dry_run: params.dry_run !== false && params.dry_run !== "false",
      sections: {
        settings: { add: 0, change: 1, same: 0, kept: 0, items: [{ key: "tenant", change: "change", before: { dqs_weights: { completeness: 0.25 } }, after: { dqs_weights: { completeness: 0.3 } } }] },
        mappings: { add: 2, change: 0, same: 14, kept: 3, items: [{ key: "material_master:MEINS", change: "add", before: null, after: { customer_field: "UOM" } }, { key: "material_master:MTART", change: "add", before: null, after: { customer_field: "MAT_TYPE" } }] },
        waves: { add: 1, change: 1, same: 1, kept: 0, items: [{ key: "Wave 4: warehouse", change: "add", before: null, after: { modules: ["ewms_stock"] } }, { key: "Wave 2: master data", change: "change", before: { target_date: "2027-01-18" }, after: { target_date: "2027-02-01" } }] },
      },
      totals: { add: 3, change: 2, same: 15, kept: 3 },
    };
    if (!diff.dry_run) audit("config_bundle.import");
    return diff;
  }
  if (path === "/admin/view-as") {
    if (method === "POST") {
      s.viewAs = str(b.role);
      audit("view_as.start");
      const names = roleActions.names as Record<string, string>;
      return { role: s.viewAs, name: names[s.viewAs] ?? s.viewAs, actions: (roleActions.roles as Record<string, string[]>)[s.viewAs] ?? [], read_only: true };
    }
    s.viewAs = null;
    audit("view_as.stop");
    return undefined;
  }
  if (method === "POST" && path === "/rules/bulk/import") {
    const content = str(b.content);
    const rows = content.includes("severity: extreme")
      ? [{ row: 1, module: "material_master", id: "ZMM900", ok: false, errors: ["severity must be one of ['critical', 'high', 'low', 'medium']"] }, { row: 2, module: "material_master", id: "ZMM901", ok: true, errors: [] }]
      : [{ row: 1, module: "material_master", id: "ZMM901", ok: true, errors: [] }, { row: 2, module: "material_master", id: "ZMM902", ok: true, errors: [] }];
    const ok = rows.filter((r) => r.ok);
    const dry = b.dry_run !== false;
    if (!dry) audit("rules.bulk_import");
    return { dry_run: dry, total: rows.length, valid: ok.length, invalid: rows.length - ok.length, created: dry ? [] : ok.map((r) => `draft-${r.id}`), rows } satisfies BulkResult;
  }
  if (method === "PUT" && path === "/admin/assignment-template") {
    s.template = b.template as AssignmentTemplate;
    s.templateSaved = true;
    audit("assignment_template.update");
    return rolesFixtureResponse("/admin/assignment-template", {});
  }
  if (method === "POST" && path === "/admin/assignment-template/apply") {
    const plan = templatePlan(s, b.modules as string[] | undefined);
    if (b.dry_run === false) {
      for (const r of plan.owners) s.owners[r.module] = r.after;
      for (const r of plan.stewards) s.stewards[`${r.module}|${r.slice_kind}|${r.slice_value}`] = r.after;
      audit("assignment_template.apply");
      return { ...plan, dry_run: false };
    }
    return plan;
  }
  return NONE_ROLES;
}

export function rolesFixtureDownload(path: string, body: unknown, fallback: string): { name: string; text: string } {
  st().lastExport = { path, body };
  if (path === "/export/grid") {
    const g = body as { title: string; columns: { header: string; key: string }[]; rows: Record<string, unknown>[] };
    const lines = [g.columns.map((c) => c.header).join(","), ...g.rows.map((r) => g.columns.map((c) => str(r[c.key])).join(","))];
    audit("export.grid");
    return { name: fallback, text: `${lines.join("\n")}\n` };
  }
  if (path === "/admin/config-bundle") return { name: fallback, text: JSON.stringify({ format: "meridian.tenant-config", version: 1, sections: { settings: {}, waves: [] } }, null, 2) };
  return { name: fallback, text: "- module: material_master\n  id: ZMM901\n" };
}
