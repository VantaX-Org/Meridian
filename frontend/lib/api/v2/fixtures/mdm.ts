import runsJson from "./runs.json";
import rulesJson from "./rules.json";
import type { RuleRow, RunList } from "../types";
import type { BusinessProcessL1, GlossaryStatus, GlossaryTermDetail, GlossaryTermSummary, MasterRecordDetail, MasterRecordSummary } from "@/types/api";
import type { PairSide, ReviewPair, ReviewPairDetail } from "@/lib/api/match-review";
import type { ExplainResponse, MergeEvent } from "@/lib/api/merge-explain";
import type { SurvivorshipRule } from "@/lib/api/survivorship";

/**
 * Fixture answers for the Golden records, Glossary and Processes tabs, in the shapes the existing endpoints return.
 * They are built on the prototype's Material master (ECC production, run 8 of 16 Oct 2026, rules MM142 to MM028):
 * 1,284 golden records, 148 pairs waiting for a steward, 6 glossary terms, and the procure-to-pay and planning
 * processes whose fields those rules read. Names, keys and counts beyond the rules are invented in the product's
 * vocabulary. Writes change the state below so a click has its visible effect; reload resets it.
 */

type Params = Record<string, string | number | boolean | undefined>;

const runs = (runsJson as unknown as RunList).versions;
const baseRules = (rulesJson as unknown as { rules: RuleRow[] }).rules;
const MM = "material_master";
const RUN = runs[0].id;
const ECC_NAME = "ECC production";

class FixtureNotFound extends Error {
  status = 404;
  constructor(path: string) {
    super(`No fixture for ${path}`);
  }
}

const state = {
  splitKeys: new Map<string, Set<string>>(),
  decidedPairs: new Set<string>(),
  termEdits: new Map<string, { business_name?: string; business_definition?: string; status?: GlossaryStatus }>(),
  reviewed: new Set<string>(),
  populated: false,
};

export function resetMdmFixture(): void {
  state.splitKeys.clear();
  state.decidedPairs.clear();
  state.termEdits.clear();
  state.reviewed.clear();
  state.populated = false;
}

const pad = (n: number): string => String(n).padStart(18, "0");
const iso = (day: number, h = 9): string => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:12:00Z`;

/* ---- golden records ---- */

const GOLDEN_TOTAL = 1284;
const PAIRS_TOTAL = 148;
const NAMES = [
  "Hex bolt M8 zinc", "Hex nut M8 zinc", "Washer 8 mm zinc", "Bearing 6204 2RS", "V-belt A42", "Hydraulic hose 1/2 in",
  "Gasket kit pump 40", "Shaft seal 35x52", "Cable gland M20", "Proximity sensor 12 mm", "Contactor 24 V 16 A", "Grease cartridge 400 g",
  "Pallet 1200x800", "Safety gloves size 9", "Filter element 10 micron", "Ball valve DN25",
];

function goldenSummary(i: number): MasterRecordSummary & { name: string } {
  const split = state.splitKeys.get(`gr-${i}`)?.size ?? 0;
  return {
    id: `gr-${i}`,
    name: nameOf(i),
    domain: MM,
    sap_object_key: `MATNR=${pad(101 + i)}`,
    overall_confidence: Math.round((0.995 - ((i * 7) % 31) / 100) * 100) / 100,
    status: i % 9 === 4 ? "pending_review" : "golden",
    source_count: Math.max(1, 2 + (i % 3) - split),
    pending_issues: i % 11 === 0 ? 1 + (i % 3) : 0,
    promoted_at: iso(1 + (i % 15)),
    created_at: iso(1 + (i % 9), 8),
    updated_at: iso(1 + ((i * 3) % 16), 10 + (i % 6)),
  };
}

function goldenList(p: Params): unknown {
  const page = Math.max(1, Number(p.page ?? 1));
  const per = Number(p.per_page ?? 25);
  const rows: (MasterRecordSummary & { name: string })[] = [];
  if (p.domain === MM) for (let i = (page - 1) * per; i < Math.min(GOLDEN_TOTAL, page * per); i++) rows.push(goldenSummary(i));
  return { records: rows, total: p.domain === MM ? GOLDEN_TOTAL : 0, page, per_page: per };
}

const idx = (id: string): number => Number(id.replace(/^gr-/, ""));
function nameOf(i: number): string {
  return `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`;
}

function goldenDetail(id: string): MasterRecordDetail {
  const i = idx(id);
  if (!Number.isInteger(i) || i < 0 || i >= GOLDEN_TOTAL) throw new FixtureNotFound(`/master-records/${id}`);
  const s = goldenSummary(i);
  const unit = ["EA", "PCS", "KG", "M", "L"][i % 5];
  return {
    id,
    domain: MM,
    sap_object_key: s.sap_object_key,
    golden_fields: { "MARA-MATNR": pad(101 + i), "MAKT-MAKTX": nameOf(i), "MARA-MEINS": unit, "MARA-MTART": i % 4 === 0 ? "HALB" : "ROH", "MARA-MATKL": ["0420", "0430", "0510", "0610"][i % 4], "MARA-BRGEW": (0.012 + (i % 7) * 0.004).toFixed(3) },
    source_contributions: {},
    overall_confidence: s.overall_confidence,
    status: s.status,
    promoted_at: s.promoted_at,
    promoted_by: "A. Naidoo",
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

const RULE_OF: Record<string, { rule: string; winner: "a" | "b" }> = {
  "MAKT-MAKTX": { rule: "most_complete", winner: "a" },
  "MARA-MEINS": { rule: "trusted_source", winner: "a" },
  "MARA-MTART": { rule: "trusted_source", winner: "a" },
  "MARA-MATKL": { rule: "most_recent", winner: "b" },
  "MARA-BRGEW": { rule: "most_recent", winner: "b" },
};

function members(i: number): string[] {
  const split = state.splitKeys.get(`gr-${i}`) ?? new Set<string>();
  const all = [`MATNR=${pad(101 + i)}`, `MATNR=${pad(20000 + i)}`, `MATNR=${pad(30000 + i)}`].slice(0, 2 + (i % 2));
  return all.filter((k) => !split.has(k));
}

function goldenExplain(id: string): ExplainResponse {
  const d = goldenDetail(id);
  const i = idx(id);
  const mem = members(i);
  const survivorship: ExplainResponse["survivorship"] = {};
  for (const [field, v] of Object.entries(d.golden_fields)) {
    const meta = RULE_OF[field];
    if (!meta) continue;
    const loser = mem[1] ?? mem[0];
    survivorship[field] = {
      value: String(v),
      winner_key: mem[0],
      rule: meta.rule,
      winner_system: ECC_NAME,
      losers: mem.length > 1 ? [{ key: loser, value: field === "MAKT-MAKTX" ? `${nameOf(i)} zinc plated` : field === "MARA-MEINS" ? "PCS" : String(v), reason: meta.rule === "most_recent" ? "older value" : meta.rule === "trusted_source" ? "not the trusted source" : "less complete", system: "Legacy plant extract" }] : [],
    };
  }
  return { golden_record_id: id, key: d.sap_object_key, domain: MM, members: mem, golden_fields: d.golden_fields, steward_overrides: {}, survivorship, pairs: [], thresholds: { auto_merge: 0.95, review_floor: 0.3 } };
}

function goldenEvents(id: string): MergeEvent[] {
  const i = idx(id);
  const mem = members(i);
  const base = { member_keys: mem, actor: "A. Naidoo", before: null, after: null, reverses_event_id: null, reversed: false };
  return [
    { ...base, id: `ev-${i}-2`, event_type: "merge", reason: "Same material, two plant extracts", created_at: iso(1 + ((i * 3) % 16), 10) },
    { ...base, id: `ev-${i}-1`, event_type: "pair_accept", reason: "Match score 0.96", created_at: iso(1 + (i % 9), 8) },
  ];
}

export const SURVIVORSHIP: SurvivorshipRule[] = [
  { id: "sv-1", domain: MM, field: "MAKT-MAKTX", rule_type: "most_complete", trusted_sources: null, weight: 1, active: true, ai_inferred: false },
  { id: "sv-2", domain: MM, field: "MARA-MEINS", rule_type: "trusted_source", trusted_sources: [ECC_NAME], weight: 1, active: true, ai_inferred: false },
  { id: "sv-3", domain: MM, field: "MARA-MTART", rule_type: "trusted_source", trusted_sources: [ECC_NAME], weight: 1, active: true, ai_inferred: false },
  { id: "sv-4", domain: MM, field: "MARA-MATKL", rule_type: "most_recent", trusted_sources: null, weight: 1, active: true, ai_inferred: true },
  { id: "sv-5", domain: MM, field: "MARA-BRGEW", rule_type: "most_recent", trusted_sources: null, weight: 1, active: true, ai_inferred: false },
];

/* ---- match candidates ---- */

function pairItem(p: number): ReviewPair {
  return {
    id: `ms-${p}`,
    domain: MM,
    a: `MATNR=${pad(5000 + p)}`,
    b: `MATNR=${pad(6000 + p)}`,
    total: Math.round((0.94 - (p % 25) / 100) * 100) / 100,
    band: "review",
    auto_action: "steward_review",
    steward_decision: null,
    constraint: null,
    explanation: null,
    field_scores: {},
    a_record_id: `gr-a-${p}`,
    b_record_id: `gr-b-${p}`,
    same_cluster: false,
  };
}

const livePairs = (): number[] => Array.from({ length: PAIRS_TOTAL }, (_, p) => p).filter((p) => !state.decidedPairs.has(`ms-${p}`));

function pairList(p: Params): unknown {
  const live = p.domain === MM ? livePairs() : [];
  const offset = Number(p.offset ?? 0);
  const limit = Number(p.limit ?? 50);
  return {
    pairs: live.slice(offset, offset + limit).map(pairItem),
    total: live.length,
    bands: { review: live.length, auto_merge: 0, low: 0 },
    thresholds: { auto_merge: 0.95, review_floor: 0.3 },
  };
}

function pairDetail(id: string): ReviewPairDetail {
  const p = Number(id.replace(/^ms-/, ""));
  if (!Number.isInteger(p) || p < 0 || p >= PAIRS_TOTAL) throw new FixtureNotFound(`/match-scores/${id}`);
  const item = pairItem(p);
  const nm = nameOf(p);
  const side = (key: string, b: boolean): PairSide => ({
    key,
    record_id: b ? item.b_record_id : item.a_record_id,
    confidence: b ? 0.82 : 0.9,
    fields: {
      "MAKT-MAKTX": b ? `${nm} zinc plated` : nm,
      "MARA-MEINS": b ? "PCS" : "EA",
      "MARA-MTART": "ROH",
      "MARA-MATKL": b ? "0430" : "0420",
      "MARA-BRGEW": b ? "0.0124" : "0.012",
      "MARC-WERKS": b ? "3000" : "3000",
    },
  });
  return { ...item, record_a: side(item.a, false), record_b: side(item.b, true), default_survivor: item.a };
}

/* ---- glossary ---- */

interface TermSeed {
  id: string;
  table: string;
  field: string;
  name: string;
  definition: string;
  status: GlossaryStatus;
  mandatory: boolean;
  rule: string | null;
  reviewed: string | null;
}

const TERMS: TermSeed[] = [
  { id: "gt-meins", table: "MARA", field: "MEINS", name: "Base unit of measure", definition: "The unit in which stock of the material is managed. Every other unit is converted to it.", status: "active", mandatory: true, rule: "MM142", reviewed: iso(9) },
  { id: "gt-mtart", table: "MARA", field: "MTART", name: "Material type", definition: "Groups materials with the same attributes, such as raw material or semi-finished product. It controls number range and field selection.", status: "active", mandatory: true, rule: "MM003", reviewed: iso(9) },
  { id: "gt-matkl", table: "MARA", field: "MATKL", name: "Material group", definition: "Classifies materials for purchasing analytics, source lists and G/L account determination.", status: "under_review", mandatory: false, rule: "MM007", reviewed: null },
  { id: "gt-brgew", table: "MARA", field: "BRGEW", name: "Gross weight", definition: "Weight of the material including its packaging, in the weight unit.", status: "active", mandatory: false, rule: "MM015", reviewed: iso(2) },
  { id: "gt-ekgrp", table: "MARC", field: "EKGRP", name: "Purchasing group", definition: "The buyer or buying team responsible for procuring the material at this plant.", status: "under_review", mandatory: false, rule: "MM302", reviewed: null },
  { id: "gt-dismm", table: "MARC", field: "DISMM", name: "MRP type", definition: "Decides whether and how the material is planned in material requirements planning.", status: "active", mandatory: true, rule: "MM023", reviewed: iso(14) },
];

const seedOf = (id: string): TermSeed => {
  const t = TERMS.find((x) => x.id === id);
  if (!t) throw new FixtureNotFound(`/glossary/${id}`);
  return t;
};

function termSummary(t: TermSeed): GlossaryTermSummary & { business_definition: string } {
  const e = state.termEdits.get(t.id);
  return {
    id: t.id,
    sap_table: t.table,
    sap_field: t.field,
    technical_name: `${t.table}-${t.field}`,
    business_name: e?.business_name ?? t.name,
    business_definition: e?.business_definition ?? t.definition,
    domain: MM,
    mandatory_for_s4hana: t.mandatory,
    status: e?.status ?? t.status,
    ai_drafted: t.id === "gt-matkl",
    last_reviewed_at: state.reviewed.has(t.id) ? iso(16, 11) : t.reviewed,
    review_cycle_days: 180,
    linked_rules_count: t.rule ? 1 : 0,
  };
}

function glossaryList(p: Params): unknown {
  const q = String(p.search ?? "").trim().toLowerCase();
  const rows = p.domain === MM ? TERMS.map(termSummary).filter((t) => !q || `${t.business_name} ${t.technical_name} ${t.sap_field}`.toLowerCase().includes(q)) : [];
  return { terms: rows, total: rows.length, page: 1, per_page: 200 };
}

function termDetail(id: string): GlossaryTermDetail {
  const t = seedOf(id);
  const s = termSummary(t);
  const e = state.termEdits.get(id);
  const rule = t.rule ? baseRules.find((r) => r.check_id === t.rule) : undefined;
  return {
    id,
    sap_table: t.table,
    sap_field: t.field,
    technical_name: s.technical_name,
    business_name: s.business_name,
    business_definition: e?.business_definition ?? t.definition,
    why_it_matters: rule?.why ?? null,
    sap_impact: null,
    domain: MM,
    approved_values: null,
    mandatory_for_s4hana: t.mandatory,
    rule_authority: t.mandatory ? "sap_hard_constraint" : "best_practice",
    data_steward_id: "u-naidoo",
    review_cycle_days: 180,
    last_reviewed_at: s.last_reviewed_at,
    status: s.status,
    ai_drafted: s.ai_drafted,
    created_at: iso(1, 8),
    updated_at: iso(14, 9),
    linked_rules: rule ? [{ rule_id: rule.check_id, domain: MM, pass_rate: rule.pass_rate, severity: rule.severity, affected_count: rule.affected_count, total_count: rule.total_count }] : [],
    change_history: [{ id: `ch-${id}`, changed_by: "A. Naidoo", changed_at: iso(9, 14), field_changed: "business_definition", old_value: null, new_value: t.definition, change_reason: "Term drafted from the rule library" }],
  };
}

/* ---- processes ---- */

type DQ = "green" | "amber" | "red";
interface FieldSeed {
  field: string;
  description: string;
  check: string | null;
  mandatory?: boolean;
}

function fieldOf(f: FieldSeed): BusinessProcessL1["l2_groups"][number]["l3_processes"][number]["l4_subprocesses"][number]["activities"][number]["fields"][number] {
  const rule = f.check ? baseRules.find((r) => r.check_id === f.check) : undefined;
  const status: DQ = rule && rule.affected_count > 0 ? "red" : "green";
  return {
    field: f.field,
    description: f.description,
    mandatory: Boolean(f.mandatory),
    config_source: f.field.endsWith("MEINS") ? "T006" : f.field.endsWith("MTART") ? "T134" : "",
    check_id: f.check,
    dq_status: status,
    pass_rate: rule?.pass_rate ?? null,
    affected_count: rule?.affected_count ?? 0,
    finding_message: rule?.name ?? "",
  };
}

type Activity = BusinessProcessL1["l2_groups"][number]["l3_processes"][number]["l4_subprocesses"][number]["activities"][number];
type Step = BusinessProcessL1["l2_groups"][number]["l3_processes"][number]["l4_subprocesses"][number];

function activity(id: string, name: string, tcode: string, description: string, fields: FieldSeed[]): Activity {
  const fs = fields.map(fieldOf);
  return { l5_id: id, l5_name: name, tcode, description, fields: fs, check_ids: fs.flatMap((f) => (f.check_id ? [f.check_id] : [])), activity_status: fs.some((f) => f.dq_status === "red") ? "red" : "green" };
}

function step(id: string, name: string, tcode: string, description: string, activities: Activity[]): Step {
  return { l4_id: id, l4_name: name, tcode, description, config_dependency: null, activities, step_status: activities.some((a) => a.activity_status === "red") ? "red" : "green" };
}

const worst = (xs: DQ[]): DQ => (xs.includes("red") ? "red" : xs.includes("amber") ? "amber" : "green");

function l1(id: string, name: string, description: string, groups: { id: string; name: string; steps: Step[] }[]): BusinessProcessL1 {
  const l2s = groups.map((g) => ({
    l2_id: g.id,
    l2_name: g.name,
    l3_processes: [{ l3_id: `${g.id}-P1`, l3_name: g.name, description: "", l4_subprocesses: g.steps, overall_readiness: worst(g.steps.map((s) => s.step_status)) }],
  }));
  return { l1_id: id, l1_name: name, l1_description: description, system: "ECC", l2_groups: l2s };
}

function processes(): BusinessProcessL1[] {
  return [
    l1("PTP", "Procure to Pay", "End-to-end procurement cycle from requisition through invoice payment.", [
      { id: "PTP-PR", name: "Purchase Requisition", steps: [step("PTP-PR-ME51N", "Create Purchase Requisition", "ME51N", "Create a requisition for a material at a plant.", [activity("PTP-PR-ME51N-01", "Enter Material and Plant", "ME51N", "Pick the material and the plant that needs it.", [{ field: "MARA.MATNR", description: "Material number", check: null, mandatory: true }, { field: "MARC.WERKS", description: "Plant", check: null, mandatory: true }])])] },
      { id: "PTP-PO", name: "Purchase Order Processing", steps: [step("PTP-PO-ME21N", "Create Standard PO", "ME21N", "Create a purchase order for a vendor.", [activity("PTP-PO-ME21N-01", "Enter Material Line", "ME21N", "Add the material, quantity and plant to the order.", [{ field: "MARA.MATNR", description: "Material number", check: null, mandatory: true }, { field: "MARC.WERKS", description: "Plant", check: null, mandatory: true }])])] },
      { id: "PTP-GR", name: "Goods Receipt", steps: [step("PTP-GR-MIGO", "Post Goods Receipt", "MIGO", "Post the delivered quantity against the order.", [
        activity("PTP-GR-MIGO-01", "Enter Quantity and Unit", "MIGO", "Enter the received quantity in the order unit; SAP converts it to the base unit.", [{ field: "MARA.MEINS", description: "Base unit of measure", check: "MM142", mandatory: true }]),
        activity("PTP-GR-MIGO-02", "Select Movement Type", "MIGO", "Movement type and stock type follow the material type.", [{ field: "MARA.MTART", description: "Material type", check: "MM003", mandatory: true }]),
      ])] },
    ]),
    l1("PP", "Plan to Produce", "Planning and production of in-house materials.", [
      { id: "PP-ORD", name: "Production Orders", steps: [step("PP-ORD-MD01", "Run MRP", "MD01", "Run the planning for the plant and create proposals.", [
        activity("PP-ORD-MD01-01", "Read MRP Data", "MD01", "Planning reads the MRP type and the procurement type.", [{ field: "MARC.DISMM", description: "MRP type", check: "MM023", mandatory: true }, { field: "MARC.BESKZ", description: "Procurement type", check: "MM028", mandatory: true }]),
        activity("PP-ORD-MD01-02", "Value the Stock", "MD01", "Valuation reads the valuation class.", [{ field: "MBEW.BKLAS", description: "Valuation class", check: "MM035", mandatory: false }]),
      ])] },
    ]),
  ];
}

/* ---- the contract ---- */

/** A GET behind the three tabs, or undefined for any other path. */
export function mdmFixture(path: string, params: Params): unknown {
  if (path === "/master-records") return goldenList(params);
  const gr = /^\/master-records\/([^/]+)(?:\/(explain|merge-events))?$/.exec(path);
  if (gr) {
    const id = decodeURIComponent(gr[1]);
    return gr[2] === "explain" ? goldenExplain(id) : gr[2] === "merge-events" ? goldenEvents(id) : goldenDetail(id);
  }
  if (path === "/match-scores") return pairList(params);
  const pair = /^\/match-scores\/([^/]+)$/.exec(path);
  if (pair) return pairDetail(decodeURIComponent(pair[1]));
  if (path === "/survivorship-rules") return { rules: params.domain === MM ? SURVIVORSHIP : [], total: params.domain === MM ? SURVIVORSHIP.length : 0 };
  if (path === "/glossary") return glossaryList(params);
  const term = /^\/glossary\/([^/]+)$/.exec(path);
  if (term) return termDetail(decodeURIComponent(term[1]));
  if (path === "/owners") return { owners: [{ kind: "object", ref: MM, owner_user_id: "u-merwe", owner_name: "T. van der Merwe", steward_user_id: "u-naidoo", steward_name: "A. Naidoo", updated_at: iso(3) }] };
  const bp = /^\/business-process\/([^/]+)\/([^/]+)$/.exec(path);
  if (bp) {
    const mod = decodeURIComponent(bp[2]);
    return mod === MM ? { version_id: RUN, module: mod, processes: processes() } : { version_id: RUN, module: mod, processes: [], reason: "no_process_definition" };
  }
  return undefined;
}

/** A write behind the three tabs, or undefined for any other path. */
export function mdmFixtureWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  const merge = /^\/match-scores\/([^/]+)\/merge$/.exec(path);
  if (method === "POST" && merge) {
    const id = decodeURIComponent(merge[1]);
    const d = pairDetail(id);
    state.decidedPairs.add(id);
    return { match_score_id: id, survivor_key: String(b.survivor ?? d.default_survivor), merged_key: d.a, golden_record_id: `gr-${Number(id.replace("ms-", ""))}`, golden_fields: {}, survivorship: {}, filled_fields: [], event_id: `ev-${id}`, dry_run: false };
  }
  const decision = /^\/match-scores\/([^/]+)\/decision$/.exec(path);
  if (method === "POST" && decision) {
    const id = decodeURIComponent(decision[1]);
    state.decidedPairs.add(id);
    return { match_score_id: id, constraint_id: `pc-${id}`, kind: "do_not_match", event_id: `ev-${id}` };
  }
  const unmerge = /^\/master-records\/([^/]+)\/unmerge$/.exec(path);
  if (method === "POST" && unmerge) {
    const id = decodeURIComponent(unmerge[1]);
    const keys = (b.keys as string[]) ?? [];
    const set = state.splitKeys.get(id) ?? new Set<string>();
    keys.forEach((k) => set.add(k));
    state.splitKeys.set(id, set);
    const left = members(idx(id));
    return { golden_record_id: id, event_id: `ev-split-${id}`, split_keys: keys, remaining_keys: left, do_not_match_pairs: keys.length, golden_fields: {} };
  }
  if (method === "POST" && path === "/glossary/populate") {
    state.populated = true;
    return { created: 2, linked: 2, objects: 1 };
  }
  const term = /^\/glossary\/([^/]+)(?:\/(review))?$/.exec(path);
  if (term) {
    const id = decodeURIComponent(term[1]);
    seedOf(id);
    if (method === "PUT") {
      const prev = state.termEdits.get(id) ?? {};
      state.termEdits.set(id, { ...prev, ...(b as { business_name?: string; business_definition?: string; status?: GlossaryStatus }) });
      return { status: "updated", changes: Object.keys(b).length };
    }
    if (method === "POST" && term[2] === "review") {
      state.reviewed.add(id);
      return { status: "reviewed", term_id: id };
    }
  }
  return undefined;
}
