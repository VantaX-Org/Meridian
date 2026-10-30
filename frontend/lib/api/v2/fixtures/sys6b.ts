/**
 * Fixture answers for step 6b: system connection, schedules, extraction scope, configuration (areas, items, SPRO
 * source, drift, comparison), custom Z objects, the rules library with its drafts and suppressions, survivorship rules
 * and the process designer's models. Reads and writes share the in-memory state below, so a click in fixture mode has
 * its visible effect; a reload (or resetSys6b) puts it back. Names, counts and keys are invented in the product's
 * vocabulary; shapes are those of the endpoints.
 */
import landscapeJson from "./landscape.json";
import { LIBRARY } from "./library";
import type { Landscape } from "../types";
import type { SAPSystemExtended, SyncProfile } from "@/types/api";
import type { ConfigLoad, LoadArea, AreaObject } from "@/lib/api/config-load";
import type { ConfigCompare, MatchRow } from "@/lib/api/config-pairing";
import type { ZAnomaly, ZCustomRule, ZDormant, ZDrift, ZGhost, ZMapping, ZProfile, ZRegistryEntry, ZReport, ZRuleTemplate } from "@/lib/api/z-objects";
import type { ModuleCoverage, Rule, RuleSuppression } from "@/lib/api/rules";
import type { SurvivorshipRule } from "@/lib/api/survivorship";
import type { ModelRecord } from "@/lib/api/process-designer";
import type { ModelSummary, ModelVersionRow, ProcessModelDocument, L4, L5 } from "@/types/process-model";
import type { RuleDraft } from "../object";
import { systemsExtended, profilesOf, objectsOf } from "./runs";
import { SURVIVORSHIP } from "./mdm";
import { DRAFTS } from "./object";

const L = landscapeJson as unknown as Landscape;
const ECC = L.systems[0];
const SF = L.systems[2];
const MM = "material_master";
type Params = Record<string, string | number | boolean | undefined>;

/** What the routers answer for a path that is not one of this step's. */
export const NOT_MINE = Symbol("not-sys6b");

/** An error shaped like the API's, so errorSentence and the designer's saveFailure read it. */
class FixtureHttp extends Error {
  response: { status: number; data: unknown };
  constructor(status: number, data: unknown, message = "Request failed") {
    super(message);
    this.response = { status, data };
  }
}
const detail = (status: number, text: string): FixtureHttp => new FixtureHttp(status, { detail: text }, text);

/* ---- the state the writes change ---- */

interface State {
  seq: number;
  created: SAPSystemExtended[];
  patched: Map<string, Partial<SAPSystemExtended>>;
  deleted: Set<string>;
  profiles: Map<string, SyncProfile[]>;
  proposed: boolean;
  zPatch: Map<string, Partial<ZRegistryEntry>>;
  zVerdict: Map<string, string>;
  zRules: ZCustomRule[];
  detected: number;
  drafts: RuleDraft[];
  published: Rule[];
  enabled: Map<string, boolean>;
  suppressions: RuleSuppression[];
  survivorship: Map<string, SurvivorshipRule[]>;
  models: Map<string, { rec: ModelRecord; versions: { note: string; doc: ProcessModelDocument }[] }>;
}

function fresh(): State {
  return {
    seq: 0,
    created: [],
    patched: new Map(),
    deleted: new Set(),
    profiles: new Map(),
    proposed: false,
    zPatch: new Map(),
    zVerdict: new Map(),
    zRules: [],
    detected: 0,
    drafts: DRAFTS.map((d) => structuredClone(d)),
    published: [],
    enabled: new Map(),
    suppressions: [],
    survivorship: new Map([[MM, SURVIVORSHIP.map((r) => ({ ...r, weight: 50 }))]]),
    models: new Map(),
  };
}
let st = fresh();

/** Puts the fixture back as a fresh page load finds it. */
export function resetSys6b(): void {
  st = fresh();
}
const nextId = (p: string): string => `${p}-${++st.seq}`;
const iso = (): string => new Date().toISOString();

/* ---- systems and schedules ---- */

function allSystems(): SAPSystemExtended[] {
  return [...systemsExtended().filter((s) => !st.deleted.has(s.id)).map((s) => ({ ...s, ...(st.patched.get(s.id) ?? {}) })), ...st.created.filter((s) => !st.deleted.has(s.id)).map((s) => ({ ...s, ...(st.patched.get(s.id) ?? {}) }))];
}

/** The landscape with the systems this session connected (not extracted yet), and without the ones it removed. */
export function withSystems(l: Landscape): Landscape {
  if (st.created.length === 0 && st.deleted.size === 0 && st.patched.size === 0) return l;
  const extra = st.created
    .filter((s) => !st.deleted.has(s.id))
    .map((s) => ({ id: s.id, name: st.patched.get(s.id)?.name ?? s.name, system_type: s.system_type, version: null, client: s.client, environment: s.environment, health_status: s.health_status, state: "not_extracted", last_extracted_at: null, records: 0 }));
  const base = l.systems.filter((s) => !st.deleted.has(s.id)).map((s) => (st.patched.get(s.id)?.name ? { ...s, name: String(st.patched.get(s.id)?.name) } : s));
  return { ...l, systems: [...base, ...(extra as unknown as Landscape["systems"])] };
}

function profilesFor(id: string): SyncProfile[] {
  let list = st.profiles.get(id);
  if (!list) {
    list = profilesOf(id).map((p) => ({ ...p }));
    st.profiles.set(id, list);
  }
  return list;
}

const nextRun = (cron: string | null | undefined, active: boolean): string | null => (cron && active ? "2026-11-02T02:00:00Z" : null);

const SCOPE: Record<string, { scope_filters: string[]; date_window: string[] }> = {
  material_master: { scope_filters: ["plants"], date_window: [] },
  business_partner: { scope_filters: ["company_codes"], date_window: [] },
  accounts_payable: { scope_filters: ["company_codes", "purchasing_orgs"], date_window: [] },
  accounts_receivable: { scope_filters: ["company_codes", "sales_orgs"], date_window: [] },
  fi_gl: { scope_filters: ["company_codes"], date_window: ["BKPF", "BSEG"] },
  mm_purchasing: { scope_filters: ["purchasing_orgs", "plants"], date_window: ["EKKO"] },
  sd_sales_orders: { scope_filters: ["sales_orgs", "plants"], date_window: ["VBAK"] },
  controlling: { scope_filters: ["company_codes"], date_window: [] },
  asset_accounting: { scope_filters: ["company_codes"], date_window: [] },
};

function objectsFor(id: string): unknown {
  const created = st.created.find((s) => s.id === id);
  const base = objectsOf(created ? ECC.id : id);
  return {
    ...base,
    objects: base.objects.map((o) => ({ ...o, ...(SCOPE[o.object] ?? {}), last_download: created ? null : o.last_download })),
  };
}

/** What a connection test says for the fields it was given: unreachable hosts and empty secrets fail, as SAP would. */
function connectionAnswer(b: { host?: string; base_url?: string; credentials?: Record<string, string>; system_type?: string }, stored: boolean): { connected: boolean; message: string; latency_ms: number | null } {
  const target = `${b.host ?? ""}${b.base_url ?? ""}`;
  if (/unreachable|down\./i.test(target)) return { connected: false, message: `Could not reach ${b.host ?? b.base_url}. Check the host name, the firewall and the instance number.`, latency_ms: null };
  const secrets = Object.values(b.credentials ?? {}).filter(Boolean);
  if (!stored && secrets.length === 0) return { connected: false, message: "No password or client secret was given. Enter the credentials to test.", latency_ms: null };
  const rfc = !b.system_type || ["ecc", "s4hana_onprem", "ewm"].includes(b.system_type);
  return { connected: true, message: `${rfc ? "RFC" : "OData"} connection succeeded.`, latency_ms: 47 };
}

/* ---- configuration ---- */

type AreaSeed = { area: string; label: string; objects: [string, string, number, AreaObject["state"], string?, AreaObject["cause"]?][] };
const AREAS: AreaSeed[] = [
  { area: "enterprise_structure", label: "Enterprise structure", objects: [["T001", "Company codes", 4, "loaded"], ["T001W", "Plants", 11, "loaded"], ["T001L", "Storage locations", 38, "loaded"]] },
  { area: "financial_accounting", label: "Financial accounting", objects: [["T003", "Document types", 22, "loaded"], ["T077S", "G/L account groups", 9, "loaded"], ["T030", "Account determination", 184, "loaded"]] },
  { area: "controlling", label: "Controlling", objects: [["TKA01", "Controlling areas", 1, "loaded"], ["TKA02", "Controlling area assignment", 4, "loaded"]] },
  { area: "asset_accounting", label: "Asset accounting", objects: [["T093C", "Asset company codes", 4, "loaded"], ["ANKA", "Asset classes", 17, "loaded"]] },
  { area: "materials_management", label: "Materials management", objects: [["T134", "Material types", 12, "loaded"], ["T023", "Material groups", 64, "loaded"], ["T006", "Units of measure", 118, "loaded"], ["T024", "Purchasing groups", 9, "loaded"]] },
  { area: "sales_distribution", label: "Sales and distribution", objects: [["TVKO", "Sales organisations", 3, "loaded"], ["TVAK", "Sales document types", 14, "loaded"]] },
  { area: "production_planning", label: "Production planning", objects: [["T399X", "Order types", 6, "loaded"], ["TC24", "Work centre types", 0, "empty"]] },
  { area: "plant_maintenance", label: "Plant maintenance", objects: [["T370A", "Equipment categories", 5, "loaded"], ["T003O", "Order types", 4, "loaded"]] },
  { area: "quality_management", label: "Quality management", objects: [["TQ30", "Inspection types", 8, "loaded"], ["QPAC", "Code groups", 0, "not_available", "Table does not exist in this release", "not_in_release"]] },
  { area: "project_system", label: "Project system", objects: [["TCJ04", "Project types", 3, "loaded"]] },
  { area: "business_partner", label: "Business partner", objects: [["TB003", "BP roles", 21, "loaded"], ["TB004", "BP groupings", 7, "loaded"]] },
  { area: "human_resources", label: "Human resources", objects: [["T500P", "Personnel areas", 0, "failed", "No authorisation (S_TABU_NAM) to read T500P", "auth"], ["T001P", "Personnel subareas", 0, "failed", "No authorisation (S_TABU_NAM) to read T001P", "auth"], ["T503K", "Employee subgroups", 9, "loaded"]] },
];

function loadAreas(): LoadArea[] {
  return AREAS.map((a) => {
    const objects: AreaObject[] = a.objects.map(([object, label, rows, state, d, cause]) => ({ object, label, state, rows, detail: d ?? (state === "loaded" ? `${rows} rows` : ""), cause: cause ?? null }));
    const failed = objects.some((o) => o.state === "failed");
    return { area: a.area, label: a.label, status: failed ? "failed" : "loaded", tables_total: objects.length, tables_done: objects.filter((o) => o.state !== "failed").length, objects };
  });
}

function configLoad(id: string): ConfigLoad | { status: "never_loaded" } {
  if (id !== ECC.id) return { status: "never_loaded" };
  const areas = loadAreas();
  const objects = areas.flatMap((a) => a.objects).map((o) => ({
    object: o.object,
    state: o.state as ConfigLoad["objects"][number]["state"],
    rows: o.rows,
    detail: o.detail,
    truncated: false,
    history: o.state === "loaded" ? { last_change: o.rows % 3 === 0 ? "2026-09-30" : "2026-05-12", changes_in_window: o.rows % 3 === 0 ? 4 : 0 } : null,
  }));
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
    areas,
    areas_loaded: 11,
    areas_total: 12,
    current_area: null,
    summary: { loaded: 24, empty: 1, failed: 2, not_available: 1 },
    objects,
    history: { source: "CDHDR", table_logging_off: false, detail: "Change documents read for 90 days", available: true },
  };
}

function configItems(object: string): unknown {
  const keys: Record<string, [string, Record<string, unknown>][]> = {
    T001: [["1000", { BUKRS: "1000", BUTXT: "Meridian Holdings", WAERS: "ZAR", LAND1: "ZA" }], ["2000", { BUKRS: "2000", BUTXT: "Meridian Trading", WAERS: "ZAR", LAND1: "ZA" }], ["3000", { BUKRS: "3000", BUTXT: "Meridian Europe", WAERS: "EUR", LAND1: "DE" }], ["4000", { BUKRS: "4000", BUTXT: "Meridian Logistics", WAERS: "USD", LAND1: "US" }]],
    T001W: [["1000", { WERKS: "1000", NAME1: "Johannesburg plant", LAND1: "ZA" }], ["1100", { WERKS: "1100", NAME1: "Durban plant", LAND1: "ZA" }], ["2000", { WERKS: "2000", NAME1: "Hamburg plant", LAND1: "DE" }]],
    T134: [["ROH", { MTART: "ROH", MTBEZ: "Raw materials" }], ["HALB", { MTART: "HALB", MTBEZ: "Semifinished products" }], ["FERT", { MTART: "FERT", MTBEZ: "Finished products" }]],
  };
  const rows = keys[object] ?? [["01", { KEY: "01", TEXT: "First entry" }], ["02", { KEY: "02", TEXT: "Second entry" }]];
  return { system_id: ECC.id, object, items: rows.map(([key, values]) => ({ key, values })) };
}

function sproConfig(module: string, id: string): unknown {
  const live = id === ECC.id;
  const tables = module === "material_master" ? ["T134", "T023", "T006"] : module === "fi_gl" || module === "fi_gl" ? ["T001", "T003", "T030"] : ["T001", "T001W"];
  return {
    module,
    source: live ? "mixed" : "baseline",
    table_sources: Object.fromEntries(tables.map((t, i) => [t, live ? (i === tables.length - 1 ? "baseline" : "live_snapshot") : "baseline"])),
    tables: Object.fromEntries(tables.map((t) => [t, (configItems(t) as { items: { values: Record<string, unknown> }[] }).items.map((x) => x.values)])),
    field_purposes: { MTART: { config_table: "T134", description: "Controls field selection and valuation for the material", impacts_features: ["Goods receipt", "MRP"] } },
  };
}

const DRIFT = {
  current_run_id: "d3229ded-0708-4967-9dfb-1b7f4fada953",
  previous_run_id: "b0500000-0000-4000-8000-000000000005",
  drift_entries: [
    { module: "material_master", element_type: "material_type", element_value: "ZVER", change_type: "added", previous_value: null, current_value: "ZVER" },
    { module: "fi_gl", element_type: "document_type", element_value: "KA", change_type: "removed", previous_value: "KA", current_value: null },
    { module: "mm_purchasing", element_type: "purchasing_group", element_value: "P04", change_type: "changed", previous_value: "Buyer group 4", current_value: "Strategic sourcing" },
  ],
};

function compare(id: string, object?: string): ConfigCompare {
  if (id !== ECC.id) return { source_load_id: null, target: { system_id: null, label: "SAP standard baseline", baseline: true }, objects: [], rows: [] };
  const rows: MatchRow[] = [
    { object: "T134", source_key: "ZVER", status: st.proposed ? "key_match" : "missing", target_key: st.proposed ? "ZVRP" : null, score: st.proposed ? 0.82 : null, field: "MTART", source_value: "ZVER", target_value: st.proposed ? "ZVRP" : null, description: "Packaging variant", proposable: !st.proposed },
    { object: "T134", source_key: "ROH", status: "exists", target_key: "ROH", score: 1, field: "MTART", source_value: "ROH", target_value: "ROH", description: "Raw materials", proposable: false },
    { object: "T023", source_key: "0420", status: "exists", target_key: "0420", score: 1, field: "MATKL", source_value: "0420", target_value: "0420", description: null, proposable: false },
    { object: "T023", source_key: "0999", status: "missing", target_key: null, score: null, field: "MATKL", source_value: "0999", target_value: null, description: "Obsolete group", proposable: true },
    { object: "T006", source_key: "ZPC", status: "desc_match", target_key: "PC", score: 0.7, field: "MSEHI", source_value: "ZPC", target_value: "PC", description: "Piece", proposable: true },
  ];
  const objs = ["T134", "T023", "T006"].map((o) => {
    const r = rows.filter((x) => x.object === o);
    const n = (s: MatchRow["status"]) => r.filter((x) => x.status === s).length;
    return { object: o, exists: n("exists"), key_match: n("key_match"), desc_match: n("desc_match"), missing: n("missing"), proposable: r.filter((x) => x.proposable).length };
  });
  return { source_load_id: "load-ecc-1", target: { system_id: "a1b2c3d4-0002-4000-8000-000000000002", label: "S/4HANA sandbox", baseline: false }, objects: objs, rows: object ? rows.filter((x) => x.object === object) : [] };
}

/* ---- custom Z objects ---- */

const Z_ENTRIES: ZRegistryEntry[] = [
  { id: "z-1", category: "table", module: MM, object_name: "ZMARA_EXT", standard_equivalent: "MARA", description: "Extension fields of the material master", owner: "T. van der Merwe", created_date: "2021-03-04", last_active_date: "2026-10-15", status: "active", transaction_count_total: 48210, rules_applied: ["ZR000412"], notes: null },
  { id: "z-2", category: "field", module: MM, object_name: "ZZPACKVAR", standard_equivalent: null, description: null, owner: null, created_date: "2022-06-20", last_active_date: "2026-09-02", status: "active", transaction_count_total: 9120, rules_applied: [], notes: null },
  { id: "z-3", category: "field", module: "fi_gl", object_name: "ZZCOSTREF", standard_equivalent: "BSEG-KOSTL", description: "Legacy cost reference", owner: "L. Botha", created_date: "2019-11-11", last_active_date: "2025-12-01", status: "dormant", transaction_count_total: 340, rules_applied: [], notes: "Candidate for retirement" },
  { id: "z-4", category: "table", module: "mm_purchasing", object_name: "ZEKKO_LOG", standard_equivalent: null, description: "Purchase order approval log", owner: "S. Dlamini", created_date: "2020-01-30", last_active_date: "2026-10-14", status: "active", transaction_count_total: 22980, rules_applied: [], notes: null },
  { id: "z-5", category: "field", module: "business_partner", object_name: "ZZVATREG", standard_equivalent: "DFKKBPTAXNUM-TAXNUM", description: "VAT registration copy", owner: null, created_date: "2018-08-08", last_active_date: "2024-04-19", status: "deprecated", transaction_count_total: 12, rules_applied: [], notes: null },
];
const Z_ANOMALIES: ZAnomaly[] = [
  { id: "za-1", object_name: "ZZPACKVAR", anomaly_type: "null_rate_spike", severity: "high", description: "Empty rate rose from 4% to 31% in the latest run", baseline_value: "4%", current_value: "31%", deviation_pct: 675, status: "active" },
  { id: "za-2", object_name: "ZMARA_EXT", anomaly_type: "volume_drop", severity: "medium", description: "Postings fell 38% against the 8-run average", baseline_value: "6,900", current_value: "4,280", deviation_pct: 38, status: "active" },
  { id: "za-3", object_name: "ZEKKO_LOG", anomaly_type: "new_value", severity: "low", description: "A new approval code appeared", baseline_value: null, current_value: "A9", deviation_pct: 2.1, status: "active" },
];
const Z_GHOST: ZGhost[] = [{ object_name: "ZZOLDFLAG", category: "field", module: MM, source_field: "MARA.ZZOLDFLAG", last_active_date: null, status: "ghost" }, { object_name: "ZZTMP01", category: "field", module: "fi_gl", source_field: "BSEG.ZZTMP01", last_active_date: "2023-02-01", status: "ghost" }];
const Z_DORMANT: ZDormant[] = [{ object_name: "ZZCOSTREF", category: "field", module: "fi_gl", last_active_date: "2025-12-01", months_inactive: 11 }, { object_name: "ZZVATREG", category: "field", module: "business_partner", last_active_date: "2024-04-19", months_inactive: 30 }];
const Z_DRIFT: ZDrift[] = [{ object_name: "ZZPACKVAR", module: MM, source_field: "MARA.ZZPACKVAR", change_type: "length_changed", first_detected: "2026-10-02" }, { object_name: "ZEKKO_LOG", module: "mm_purchasing", source_field: "EKKO.ZZAPPR", change_type: "added", first_detected: "2026-09-18" }];
const Z_TEMPLATES: ZRuleTemplate[] = [
  { template_id: "zt-null", name: "Not empty", description: "The custom field has a value on every record that uses it", default_severity: "medium", applicable_to: "field" },
  { template_id: "zt-domain", name: "Value in list", description: "The value is one of the approved codes", default_severity: "high", applicable_to: "field" },
];

function zEntries(): ZRegistryEntry[] {
  return Z_ENTRIES.map((e) => ({ ...e, ...(st.zPatch.get(e.id) ?? {}) }));
}
function zAnomalies(): ZAnomaly[] {
  return Z_ANOMALIES.map((a) => ({ ...a, status: st.zVerdict.get(a.id ?? "") ?? a.status }));
}
function zReport(): ZReport {
  const e = zEntries();
  const by = (k: "status" | "module" | "category") => e.reduce<Record<string, number>>((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
  return { total_z_objects: e.length, by_status: by("status"), by_module: by("module"), by_category: by("category"), active_anomalies: zAnomalies().filter((a) => a.status === "active").length, ghost_objects: Z_GHOST.length, dormant_objects: Z_DORMANT.length, mapped_to_standard: e.filter((x) => x.standard_equivalent).length, unmapped: e.filter((x) => !x.standard_equivalent).length };
}

/* ---- the rules library ---- */

interface LibRule { check_id: string; message: string; module: string; category: string; severity: "critical" | "high" | "medium" | "low"; check_class: string; dimension: string; field: string; pass: number; failing: number; source: "yaml" | "custom" }

/** The shipped rules the demo tenant's run measured (library.json, sampled from checks/rules by scripts/fixture-rules.py). */
function libRules(): LibRule[] {
  const out: LibRule[] = LIBRARY.map((r) => ({ check_id: r.check_id, message: r.name, module: r.module, category: "ecc", severity: r.severity, check_class: r.check_class, dimension: r.dimension, field: r.field ?? "", pass: r.total > 0 ? Math.round((1 - r.failing / r.total) * 10000) / 100 : 100, failing: r.failing, source: "yaml" }));
  for (const p of st.published) {
    const id = p.name.split(":")[0];
    out.push({ check_id: id, message: p.name.slice(id.length + 2), module: p.module, category: "ecc", severity: p.severity as LibRule["severity"], check_class: "cross_field_check", dimension: "consistency", field: "MARA.NTGEW", pass: 99.7, failing: 212, source: "custom" });
  }
  return out;
}

function ruleRow(r: LibRule): Rule {
  const id = `rule-${r.check_id}`;
  return {
    id,
    name: `${r.check_id}: ${r.message}`,
    description: null,
    module: r.module,
    category: r.category,
    severity: r.severity,
    enabled: st.enabled.get(id) ?? true,
    conditions: null,
    thresholds: null,
    tags: null,
    source_yaml: null,
    source: r.source,
    created_at: "2026-06-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    last_pass_rate: r.pass,
    last_run_at: "2026-10-16T05:17:00Z",
    last_affected_count: r.failing,
  };
}

function moduleCoverage(module: string): ModuleCoverage {
  const rules = libRules().filter((r) => r.module === module);
  return {
    module,
    has_view_map: false,
    object: { module, by_dimension: {}, total: rules.length, never_run: 0 },
    views: [{ view: "all", label: "All rules", total: rules.length, tables: [], rules: rules.map((r) => ({ check_id: r.check_id, message: r.message, check_class: r.check_class, severity: r.severity, dimension: r.dimension, field: r.field, last_pass_rate: r.pass })) }],
    dimension_by_view: {},
    totals: { rules: rules.length, never_run: 0, views: 1, views_total: 1, tables: 0 },
  };
}

/* ---- the process designer ---- */

const act = (id: string, name: string, order: number, fields: string[]): L5 => ({
  id, name, description: "", order, tcode: null,
  fields: fields.map((f) => ({ field: f, check_id: null, description: "", mandatory: false, config_source: null })),
  check_ids: [], sap_tables: [...new Set(fields.map((f) => f.split(".")[0]))],
});
const step = (id: string, name: string, tcode: string, order: number, acts: L5[]): L4 => ({
  id, name, description: "", order, tcode, config_dependency: null, activities: acts, variants: [],
  diagram: { nodes: [{ id: `${id}-S`, type: "startEvent", activity_id: null, label: null, x: 24, y: 40 }, { id: `${id}-E`, type: "endEvent", activity_id: null, label: null, x: 144, y: 40 }], flows: [{ id: `${id}-F`, source: `${id}-S`, target: `${id}-E`, label: null, condition: null }] },
});

function referenceDoc(): ProcessModelDocument {
  return {
    schema_version: 1,
    source: "template",
    l1: [
      {
        id: "PTP", name: "Procure to pay", description: "From requisition to payment", order: 1, modules: ["material_master", "mm_purchasing", "accounts_payable"],
        l2: [
          { id: "PTP-SRC", name: "Sourcing", description: "", order: 1, l3: [{ id: "PTP-SRC-PO", name: "Purchase order", description: "", order: 1, l4: [step("PTP-SRC-ME21N", "Create purchase order", "ME21N", 1, [act("PTP-SRC-ME21N-A1", "Enter order header", 1, ["EKKO.LIFNR", "EKKO.EKORG"]), act("PTP-SRC-ME21N-A2", "Enter order items", 2, ["MARA.MATNR", "EKPO.MENGE"])])] }] },
          { id: "PTP-GR", name: "Goods receipt", description: "", order: 2, l3: [{ id: "PTP-GR-IN", name: "Inbound delivery", description: "", order: 1, l4: [step("PTP-GR-MIGO", "Post goods receipt", "MIGO", 1, [act("PTP-GR-MIGO-A1", "Check the material", 1, ["MARA.MEINS", "MARA.MTART"])])] }] },
        ],
      },
      { id: "OTC", name: "Order to cash", description: "From sales order to cash receipt", order: 2, modules: ["sd_customer_master", "sd_sales_orders"], l2: [{ id: "OTC-SO", name: "Sales order", description: "", order: 1, l3: [{ id: "OTC-SO-CR", name: "Create sales order", description: "", order: 1, l4: [step("OTC-SO-VA01", "Create sales order", "VA01", 1, [act("OTC-SO-VA01-A1", "Enter the order", 1, ["VBAK.KUNNR", "MARA.MATNR"])])] }] }] },
    ],
  };
}

function modelSummary(m: { rec: ModelRecord }): ModelSummary {
  return { id: m.rec.id, name: m.rec.name, status: m.rec.status, current_version: m.rec.current_version, updated_at: m.rec.updated_at };
}

function seedModel(): void {
  if (st.models.size) return;
  const rec: ModelRecord = { id: "pm-1", name: "Group process model", status: "draft", current_version: 1, updated_at: "2026-10-12T09:00:00Z", created_by: "A. Naidoo", created_at: "2026-10-01T09:00:00Z" };
  st.models.set(rec.id, { rec, versions: [{ note: "Created from reference", doc: referenceDoc() }] });
}

function validateDoc(doc: ProcessModelDocument): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const ids = new Set<string>();
  const check = (path: string, id: string, name: string) => {
    if (!name.trim()) errors.push({ path, message: "A name is required" });
    if (ids.has(id)) errors.push({ path, message: `The id ${id} is used twice` });
    ids.add(id);
  };
  doc.l1.forEach((a, i) => {
    check(`l1.${i}.name`, a.id, a.name);
    a.l2.forEach((b, j) => {
      check(`l1.${i}.l2.${j}.name`, b.id, b.name);
      b.l3.forEach((c, k) => {
        check(`l1.${i}.l2.${j}.l3.${k}.name`, c.id, c.name);
        c.l4.forEach((d, m) => {
          check(`l1.${i}.l2.${j}.l3.${k}.l4.${m}.name`, d.id, d.name);
          d.activities.forEach((x, n) => check(`l1.${i}.l2.${j}.l3.${k}.l4.${m}.activities.${n}.name`, x.id, x.name));
        });
      });
    });
  });
  return errors;
}

/* ---- the router: reads ---- */

/** The answer to one step 6b read, or NOT_MINE when the path is not one of this step's. */
export function sys6bRead(path: string, params: Params): unknown {
  if (path === "/systems") return allSystems();
  const sys = /^\/systems\/([^/]+)\/(objects|profiles)$/.exec(path);
  if (sys) {
    const id = decodeURIComponent(sys[1]);
    return sys[2] === "objects" ? objectsFor(id) : profilesFor(id).map((p) => ({ ...p }));
  }
  const cfg = /^\/connectivity\/config-load\/([^/]+)$/.exec(path);
  if (cfg) return configLoad(decodeURIComponent(cfg[1]));
  if (/^\/connectivity\/config-load\/[^/]+\/items$/.test(path)) return configItems(String(params.object ?? ""));
  const spro = /^\/spro\/config\/([^/]+)$/.exec(path);
  if (spro) return sproConfig(decodeURIComponent(spro[1]), String(params.system_id ?? ""));
  if (path === "/config/drift") return DRIFT;
  const cmp = /^\/config-pairing\/compare\/([^/]+)$/.exec(path);
  if (cmp) return compare(decodeURIComponent(cmp[1]), params.object ? String(params.object) : undefined);

  if (path === "/z-objects/registry") return { total: Z_ENTRIES.length, entries: zEntries() };
  const zp = /^\/z-objects\/profile\/([^/]+)$/.exec(path);
  if (zp) {
    const e = Z_ENTRIES.find((x) => x.id === decodeURIComponent(zp[1]));
    if (!e) throw detail(404, "No profile recorded for this object");
    const p: ZProfile = { object_name: e.object_name, data_type: "CHAR", cardinality: 14 + e.transaction_count_total % 40, null_rate: e.id === "z-2" ? 0.31 : 0.04, transaction_count: e.transaction_count_total, user_count: 6, first_seen: e.created_date, last_seen: e.last_active_date, trend_direction: e.id === "z-2" ? "falling" : "stable", related_standard_field: e.standard_equivalent };
    return p;
  }
  if (path === "/z-objects/anomalies") return { run_id: "d3229ded-0708-4967-9dfb-1b7f4fada953", total: Z_ANOMALIES.length, anomalies: zAnomalies() };
  if (path === "/z-objects/ghost") return Z_GHOST;
  if (path === "/z-objects/dormant") return Z_DORMANT;
  if (path === "/z-objects/drift") return Z_DRIFT;
  if (path === "/z-objects/rules") return { templates: Z_TEMPLATES, custom_rules: [...st.zRules] };
  if (path === "/z-objects/report") return zReport();
  if (path === "/z-objects/mapping") return { total: Z_ENTRIES.length, mappings: Z_ENTRIES.map<ZMapping>((e) => ({ object_name: e.object_name, module: e.module, standard_equivalent: e.standard_equivalent, confidence: e.standard_equivalent ? 0.9 : 0, mapping_source: "auto" })) };

  if (path === "/rules") {
    // Paged as the API pages it: limit (at most 1000) and offset, optionally one object.
    const all = libRules().filter((r) => !params.module || r.module === params.module).map(ruleRow);
    const limit = Math.min(1000, Number(params.limit ?? 500));
    const offset = Number(params.offset ?? 0);
    return { rules: all.slice(offset, offset + limit), total: all.length, limit, offset };
  }
  const cov = /^\/rules\/coverage\/([^/]+)$/.exec(path);
  if (cov) return moduleCoverage(decodeURIComponent(cov[1]));
  if (path === "/rule-suppressions") return { suppressions: [...st.suppressions] };
  if (path === "/rule-authoring/drafts") return { items: st.drafts.filter((d) => !params.module || d.domain === `dq_rule:${params.module}`) };

  if (path === "/survivorship-rules") {
    const domain = String(params.domain ?? "");
    const rules = st.survivorship.get(domain) ?? [];
    return { rules, total: rules.length };
  }

  seedModel();
  if (path === "/process-designer/reference") return referenceDoc();
  if (path === "/process-designer/models") return [...st.models.values()].map(modelSummary);
  const mv = /^\/process-designer\/models\/([^/]+)\/versions$/.exec(path);
  if (mv) {
    const m = st.models.get(decodeURIComponent(mv[1]));
    if (!m) throw detail(404, "Model not found");
    return m.versions.map<ModelVersionRow>((v, i) => ({ version_no: i + 1, note: v.note, created_by: "A. Naidoo", created_at: "2026-10-12T09:00:00Z" })).reverse();
  }
  const mo = /^\/process-designer\/models\/([^/]+)$/.exec(path);
  if (mo) {
    const m = st.models.get(decodeURIComponent(mo[1]));
    if (!m) throw detail(404, "Model not found");
    const vno = Number(params.version ?? m.rec.current_version);
    return { model: m.rec, version_no: vno, document: structuredClone(m.versions[vno - 1].doc) };
  }
  return NOT_MINE;
}

/* ---- the router: writes ---- */

function newSystem(b: Record<string, unknown>): SAPSystemExtended {
  const id = `b1b2c3d4-9${String(++st.seq).padStart(3, "0")}-4000-8000-000000000099`;
  const now = iso();
  return {
    id, name: String(b.name), system_type: b.system_type as SAPSystemExtended["system_type"], host: (b.host as string) ?? null, client: (b.client as string) ?? null, sysnr: (b.sysnr as string) ?? null,
    username: (b.username as string) ?? null, base_url: (b.base_url as string) ?? null, company_id: (b.company_id as string) ?? null, auth_type: (b.auth_type as SAPSystemExtended["auth_type"]) ?? null,
    token_url: (b.token_url as string) ?? null, description: (b.description as string) ?? null, environment: b.environment as SAPSystemExtended["environment"], is_active: true,
    health_status: "unknown", health_message: null, last_health_check: null, config_last_synced_at: null, config_sync_status: null, created_at: now, updated_at: now, last_sync_at: null, last_sync_status: null,
    discovery_status: null, discovered_at: null, sap_release: null, last_analysis_at: null, role: "source", target_system_id: null,
  };
}

/** The answer to one step 6b write (null for a delete), or NOT_MINE when the path is not one of this step's. */
export function sys6bWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown> & { credentials?: Record<string, string> };
  if (method === "POST" && path === "/systems") {
    if (allSystems().some((s) => s.name.toLowerCase() === String(b.name).toLowerCase())) throw detail(409, "A system with this name exists");
    const s = newSystem(b);
    st.created.push(s);
    return s;
  }
  if (method === "POST" && path === "/systems/test-connection") return connectionAnswer(b as never, false);
  const te = /^\/systems\/([^/]+)\/test-connection$/.exec(path);
  if (method === "POST" && te) return connectionAnswer(b as never, true);
  const one = /^\/systems\/([^/]+)$/.exec(path);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (!allSystems().some((s) => s.id === id)) throw detail(404, "System not found");
    if (method === "PUT") {
      const { credentials, ...rest } = b;
      const patch: Partial<SAPSystemExtended> = { ...(rest as Partial<SAPSystemExtended>), updated_at: iso() };
      if (credentials && Object.keys(credentials).length) Object.assign(patch, { health_status: "unknown", health_message: "Credentials changed. Test the connection." });
      if (rest.token_url === "") patch.token_url = null;
      st.patched.set(id, { ...(st.patched.get(id) ?? {}), ...patch });
      return allSystems().find((s) => s.id === id);
    }
    if (method === "DELETE") {
      st.deleted.add(id);
      return null;
    }
  }
  const pr = /^\/systems\/([^/]+)\/profiles(?:\/([^/]+))?$/.exec(path);
  if (pr) {
    const sid = decodeURIComponent(pr[1]);
    const list = profilesFor(sid);
    if (method === "POST" && !pr[2]) {
      if (list.some((p) => p.domain === b.domain)) throw detail(409, "This object already has a schedule");
      const p: SyncProfile = { id: nextId("p-new"), system_id: sid, domain: String(b.domain), tables: (b.tables as string[]) ?? [], schedule_cron: (b.schedule_cron as string) ?? null, active: b.active !== false, last_run_at: null, next_run_at: nextRun(b.schedule_cron as string, b.active !== false), extraction_mode: (b.extraction_mode as "full" | "delta") ?? "full" };
      list.push(p);
      return p;
    }
    const p = list.find((x) => x.id === pr[2]);
    if (!p) throw detail(404, "Schedule not found");
    if (method === "PATCH") {
      Object.assign(p, b);
      p.next_run_at = nextRun(p.schedule_cron, p.active);
      return p;
    }
    if (method === "DELETE") {
      list.splice(list.indexOf(p), 1);
      return null;
    }
  }
  if (method === "POST" && /^\/config-pairing\/propose\//.test(path)) {
    const n = st.proposed ? 0 : 2;
    st.proposed = true;
    return { proposed: n, skipped: 0, target: "S/4HANA sandbox" };
  }
  if (method === "POST" && (path === "/z-objects/detect/latest" || path === "/config/discover/latest")) {
    st.detected += 1;
    return { queued: true, version_id: "d3229ded-0708-4967-9dfb-1b7f4fada953" };
  }
  const zr = /^\/z-objects\/registry\/([^/]+)$/.exec(path);
  if (method === "PUT" && zr) {
    const id = decodeURIComponent(zr[1]);
    if (!Z_ENTRIES.some((e) => e.id === id)) throw detail(404, "Not found");
    st.zPatch.set(id, { ...(st.zPatch.get(id) ?? {}), ...(b as Partial<ZRegistryEntry>) });
    return zEntries().find((e) => e.id === id);
  }
  const za = /^\/z-objects\/anomalies\/([^/]+)\/feedback$/.exec(path);
  if (method === "POST" && za) {
    const id = decodeURIComponent(za[1]);
    st.zVerdict.set(id, String(b.status));
    return zAnomalies().find((a) => a.id === id);
  }
  if (method === "POST" && path === "/z-objects/rules") {
    const r: ZCustomRule = { id: nextId("zr"), z_object_id: (b.z_object_id as string) ?? null, rule_template_id: null, rule_name: String(b.rule_name), custom_condition: String(b.custom_condition), severity: String(b.severity), is_active: true, created_at: iso() };
    st.zRules.push(r);
    return { id: r.id, status: "created" };
  }

  const pe = /^\/rules\/([^/]+)$/.exec(path);
  if (method === "PATCH" && pe) {
    st.enabled.set(decodeURIComponent(pe[1]), Boolean(b.enabled));
    const row = libRules().map(ruleRow).find((r) => r.id === decodeURIComponent(pe[1]));
    if (!row) throw detail(404, "Rule not found");
    return row;
  }
  if (method === "POST" && path === "/rule-suppressions") {
    const s: RuleSuppression = { id: nextId("sup"), check_id: String(b.check_id), record_key: null, reason: String(b.reason), expires_at: String(b.expires_at), created_by: "Demo user", created_at: iso(), active: true };
    st.suppressions.push(s);
    return { id: s.id, check_id: s.check_id, expires_at: s.expires_at };
  }
  const se = /^\/rule-suppressions\/([^/]+)$/.exec(path);
  if (method === "DELETE" && se) {
    st.suppressions = st.suppressions.filter((s) => s.id !== decodeURIComponent(se[1]));
    return null;
  }
  if (method === "POST" && path === "/rule-authoring/dry-run") return { version_id: "d3229ded-0708-4967-9dfb-1b7f4fada953", evaluated: true, hits: 212, population: 61816, pass_rate: 99.66, sample: [] };
  if (method === "POST" && path === "/rule-authoring/generate") {
    const d = String(b.description ?? "");
    return { rule_yaml: "", valid: true, errors: [], rule: { id: "ZR000500", check_class: "null_check", severity: "medium", dimension: "completeness", message: d.slice(0, 80), field: "MARA.MATNR" } };
  }
  if (method === "POST" && path === "/rule-authoring/drafts") {
    const rule = JSON.parse(String(b.rule_yaml)) as RuleDraft["proposed_rule"];
    const d: RuleDraft = { id: nextId("dr"), domain: `dq_rule:${b.module}`, proposed_rule: rule, rationale: (b.rationale as string) ?? null, status: "draft", created_at: iso() };
    st.drafts.unshift(d);
    return { id: d.id, status: "draft", rule };
  }
  const dr = /^\/rule-authoring\/drafts\/([^/]+)(\/publish)?$/.exec(path);
  if (dr) {
    const id = decodeURIComponent(dr[1]);
    const d = st.drafts.find((x) => x.id === id);
    if (!d) throw detail(404, "Draft not found");
    if (method === "PUT") {
      d.domain = `dq_rule:${b.module}`;
      d.proposed_rule = JSON.parse(String(b.rule_yaml));
      if (b.rationale) d.rationale = String(b.rationale);
      return { id, status: "draft", rule: d.proposed_rule };
    }
    if (method === "DELETE") {
      st.drafts = st.drafts.filter((x) => x.id !== id);
      return null;
    }
    if (method === "POST" && dr[2]) {
      st.drafts = st.drafts.filter((x) => x.id !== id);
      const ruleId = String(d.proposed_rule.id ?? "ZR000999");
      const name = `${ruleId}: ${d.proposed_rule.message ?? "Custom rule"}`;
      const mod = d.domain.replace("dq_rule:", "");
      st.published.push({ id: `rule-${ruleId}`, name, module: mod, severity: String(d.proposed_rule.severity ?? "medium") } as Rule);
      return { id: `rule-${ruleId}`, name, module: mod, severity: String(d.proposed_rule.severity ?? "medium"), enabled: true, draft_id: id };
    }
  }

  if (method === "PUT" && path === "/survivorship-rules") {
    const domain = String(b.domain);
    const prior = st.survivorship.get(domain) ?? [];
    const incoming = (b.rules as { field: string; rule_type: SurvivorshipRule["rule_type"]; trusted_sources: string[] | null; weight: number; active: boolean }[]) ?? [];
    const fields = incoming.map((r) => r.field);
    const dupes = [...new Set(fields.filter((f, i) => fields.indexOf(f) !== i))];
    if (dupes.length) throw detail(422, `duplicate rule for field(s): ${dupes.join(", ")}`);
    const next = incoming
      .map<SurvivorshipRule>((r) => {
        const old = prior.find((p) => p.field === r.field);
        const same = old && old.rule_type === r.rule_type && JSON.stringify(old.trusted_sources ?? []) === JSON.stringify(r.trusted_sources ?? []) && old.weight === r.weight && old.active === r.active;
        return { id: old?.id ?? nextId("sv"), domain, ...r, ai_inferred: Boolean(old?.ai_inferred && same) };
      })
      .sort((a, c) => a.field.localeCompare(c.field));
    st.survivorship.set(domain, next);
    return { rules: next, total: next.length };
  }

  seedModel();
  if (method === "POST" && path === "/process-designer/models") {
    const name = String(b.name ?? "").trim();
    if (!name) throw detail(422, "Name is required");
    if ([...st.models.values()].some((m) => m.rec.name === name)) throw detail(409, "A model with this name exists");
    const from = String(b.from);
    const doc = from === "reference" ? referenceDoc() : structuredClone(st.models.get(from)?.versions.at(-1)?.doc ?? referenceDoc());
    const rec: ModelRecord = { id: nextId("pm"), name, status: "draft", current_version: 1, updated_at: iso(), created_by: "Demo user", created_at: iso() };
    st.models.set(rec.id, { rec, versions: [{ note: `Created from ${from === "reference" ? "reference" : `model ${from}`}`, doc }] });
    return { model: rec, version_no: 1 };
  }
  const mm = /^\/process-designer\/models\/([^/]+)$/.exec(path);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    const m = st.models.get(id);
    if (!m) throw detail(404, "Model not found");
    if (method === "PUT") {
      if (Number(b.base_version) !== m.rec.current_version) throw new FixtureHttp(409, { detail: { message: "The model changed since you loaded it", current_version: m.rec.current_version } });
      const errors = validateDoc(b.document as ProcessModelDocument);
      if (errors.length) throw new FixtureHttp(422, { errors });
      m.versions.push({ note: String(b.note ?? ""), doc: structuredClone(b.document as ProcessModelDocument) });
      m.rec = { ...m.rec, current_version: m.versions.length, updated_at: iso() };
      return { model: m.rec, version_no: m.versions.length, warnings: [] };
    }
    if (method === "PATCH") {
      if (b.name) {
        if ([...st.models.values()].some((x) => x.rec.id !== id && x.rec.name === b.name)) throw detail(409, "A model with this name exists");
        m.rec = { ...m.rec, name: String(b.name) };
      }
      if (b.status) m.rec = { ...m.rec, status: String(b.status) };
      m.rec = { ...m.rec, updated_at: iso() };
      return m.rec;
    }
    if (method === "DELETE") {
      st.models.delete(id);
      return null;
    }
  }
  return NOT_MINE;
}

export { SF as FIXTURE_CLOUD_SYSTEM };
