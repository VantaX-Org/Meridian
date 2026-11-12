/**
 * System comparison fixture, shaped like api/routes/system_compare.py: one ECC production to S/4HANA pair for the
 * material master with two comparisons. Synthetic values only. Writes change the in-memory pairs until reload.
 */
import type { Comparison, ComparePair, DiffRow, KeyMap, TableCompare } from "../compare";

export const NONE_COMPARE = Symbol("not a compare path");

const ECC = { id: "a1b2c3d4-0001-4000-8000-000000000001", name: "ECC production", type: "ecc" };
const S4 = { id: "a1b2c3d4-0002-4000-8000-000000000002", name: "S/4HANA quality", type: "s4hana" };
const SF = { id: "a1b2c3d4-0003-4000-8000-000000000003", name: "SuccessFactors", type: "successfactors" };

const scores = {
  module: "material_master", source: 78.4, projected: 86.1, actual: 83.7, actual_reason: null, projected_reason: null,
  migration_run_id: "mig-0002",
  reasons: [
    { check_id: "MM-MARA-MTART-001", description: "Material type is a valid type in T134", severity: "critical", dimension: "validity", source_pass_rate: 91, target_pass_rate: 99, change: 8 },
    { check_id: "MM-MARC-DISMM-004", description: "MRP type set for every plant view", severity: "high", dimension: "completeness", source_pass_rate: 97, target_pass_rate: 88, change: -9 },
    { check_id: "MM-MARA-BISMT-002", description: "Old material number holds the ECC number", severity: "medium", dimension: "consistency", source_pass_rate: 60, target_pass_rate: 95, change: 35 },
  ],
};

const tables: TableCompare[] = [
  {
    table: "MARA", description: "General material data", comparable: true, reason: null, source_keys: ["MATNR"], target_keys: ["MATNR"],
    key_mapped: 0, in_source: 12_400, in_target: 12_310, matched: 12_290, missing_in_target: 110, extra_in_target: 20,
    duplicate_source: 0, duplicate_target: 0, capped: true, records_total: { missing: 110, extra: 20, differing: 42 },
    fields: [
      { field: "MTART", description: "Material type", compared: 12_290, equal: 12_248, transformed: { code_map: 0 }, differing: 42, withheld: false },
      { field: "ERSDA", description: "Created on", compared: 12_290, equal: 11_000, transformed: { date_format: 1_290 }, differing: 0, withheld: false },
      { field: "MEINS", description: "Base unit of measure", compared: 12_290, equal: 12_100, transformed: { code_map: 190 }, differing: 0, withheld: false },
    ],
  },
  {
    table: "MARC", description: "Plant data for material", comparable: true, reason: null, source_keys: ["MATNR", "WERKS"], target_keys: ["MATNR", "WERKS"],
    key_mapped: 0, in_source: 30_120, in_target: 30_050, matched: 30_050, missing_in_target: 70, extra_in_target: 0,
    duplicate_source: 0, duplicate_target: 0, capped: false, records_total: { missing: 70, extra: 0, differing: 3 },
    fields: [
      { field: "DISMM", description: "MRP type", compared: 30_050, equal: 30_047, transformed: {}, differing: 3, withheld: false },
      { field: "EKGRP", description: "Purchasing group", compared: 30_050, equal: 29_950, transformed: { leading_zeros: 100 }, differing: 0, withheld: false },
    ],
  },
  {
    table: "MBEW", description: "Material valuation", comparable: false, reason: "target_extract_partial", source_keys: ["MATNR", "BWKEY", "BWTAR"], target_keys: ["MATNR", "BWKEY", "BWTAR"],
    key_mapped: 0, in_source: 29_800, in_target: 4_000, matched: 0, missing_in_target: 0, extra_in_target: 0,
    duplicate_source: 0, duplicate_target: 0, capped: false, records_total: { missing: 0, extra: 0, differing: 0 }, fields: [],
  },
];

const rows: DiffRow[] = [
  { table: "MARA", table_text: "General material data", kind: "differing", key: "MATNR=10004711", field: "MTART", field_text: "Material type", source: "HALB", target: "ZHLB" },
  { table: "MARA", table_text: "General material data", kind: "differing", key: "MATNR=10004712", field: "MTART", field_text: "Material type", source: "HALB", target: "ZHLB" },
  { table: "MARA", table_text: "General material data", kind: "missing", key: "MATNR=10009001", field: null, field_text: "", source: null, target: null },
  { table: "MARA", table_text: "General material data", kind: "extra", key: "MATNR=20000001", field: null, field_text: "", source: null, target: null },
  { table: "MARC", table_text: "Plant data for material", kind: "differing", key: "MATNR=10004711|WERKS=1000", field: "DISMM", field_text: "MRP type", source: "PD", target: "ND" },
  { table: "MARC", table_text: "Plant data for material", kind: "missing", key: "MATNR=10009001|WERKS=1000", field: null, field_text: "", source: null, target: null },
];

const summary = { tables: 3, comparable: 2, in_source: 42_520, in_target: 42_360, matched: 42_340, missing_in_target: 180, extra_in_target: 20, key_mapped: 0, differing_fields: 45, transformed_fields: 1_580 };

const comparison: Comparison = {
  id: "cmp-0002", pair_id: "pair-0001", status: "done", progress: { stage: "done", done: 3, total: 3 }, error: null,
  created_at: "2026-11-10T06:00:00Z", completed_at: "2026-11-10T06:04:00Z", summary, tables, scores,
  config: {
    available: true, only_in_source: ["T001L"], only_in_target: [],
    objects: [
      { object: "T134", exists: 14, key_match: 0, desc_match: 1, missing: 1, in_source: 16, in_target: 17, only_in_target: 2 },
      { object: "T001W", exists: 8, key_match: 0, desc_match: 0, missing: 0, in_source: 8, in_target: 8, only_in_target: 0 },
    ],
  },
};

const at = (d: string) => `2026-11-${d}T06:00:00Z`;
let pairs: ComparePair[] = [{
  id: "pair-0001", module: "material_master", key_map: {}, source: ECC, target: S4, created_at: at("01"), updated_at: at("01"),
  last: { id: comparison.id, status: "done", at: comparison.completed_at, summary, scores },
}];
let seq = 1;

const pageOf = (p: Record<string, unknown>) => {
  const hit = rows.filter((r) => (!p.table || r.table === p.table) && (!p.kind || r.kind === p.kind) && (!p.field || r.field === p.field)
    && (!p.q || JSON.stringify(r).toLowerCase().includes(String(p.q).toLowerCase())));
  const offset = Number(p.offset ?? 0), limit = Number(p.limit ?? 50);
  return { total: hit.length, offset, rows: hit.slice(offset, offset + limit), kinds: ["missing", "extra", "differing"] };
};

export function compareRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/compare/pairs") return { pairs, suggestions: [{ source: ECC, target: S4 }], systems: [ECC, S4, SF], modules: ["material_master", "sd_customer_master", "employee_central"] };
  let m = /^\/compare\/pairs\/([^/]+)\/(latest|trend)$/.exec(path);
  if (m) {
    const pair = pairs.find((p) => p.id === m![1]);
    if (!pair) return NONE_COMPARE;
    if (m[2] === "latest") return { pair, comparison: pair.last ? comparison : null };
    return { points: [
      { comparison_id: "cmp-0001", at: at("03"), source: 76.2, projected: 84.0, actual: 79.5, missing_in_target: 410, differing_fields: 120 },
      { comparison_id: "cmp-0002", at: at("10"), source: 78.4, projected: 86.1, actual: 83.7, missing_in_target: 180, differing_fields: 45 },
    ] };
  }
  m = /^\/compare\/comparisons\/([^/]+)(\/differences|\/pair)?$/.exec(path);
  if (!m) return NONE_COMPARE;
  if (!m[2]) return comparison;
  if (m[2] === "/differences") return pageOf(params);
  const key = String(params.key ?? "");
  const hit = rows.filter((r) => r.table === params.table && r.key === key);
  const kind = hit[0]?.kind;
  return {
    table: params.table, key, in_source: kind !== "extra", in_target: kind !== "missing",
    fields: (tables.find((t) => t.table === params.table)?.fields ?? []).map((f) => {
      const d = hit.find((r) => r.field === f.field);
      return { field: f.field, description: f.description, source: kind === "extra" ? null : d?.source ?? "X", target: kind === "missing" ? null : d?.target ?? "X", verdict: d ? "differing" : kind === "differing" ? "equal" : kind ?? "equal" };
    }),
  };
}

export function compareWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as { module?: string; source_system_id?: string; target_system_id?: string; key_map?: KeyMap };
  const sys = (id?: string) => [ECC, S4, SF].find((s) => s.id === id) ?? ECC;
  if (method === "POST" && path === "/compare/pairs") {
    const p: ComparePair = { id: `pair-new-${++seq}`, module: b.module ?? "material_master", key_map: b.key_map ?? {}, source: sys(b.source_system_id), target: sys(b.target_system_id), created_at: at("11"), updated_at: at("11"), last: null };
    pairs = [...pairs, p];
    return p;
  }
  const m = /^\/compare\/pairs\/([^/]+)(\/run)?$/.exec(path);
  if (!m) return NONE_COMPARE;
  if (m[2]) return { comparison_id: `cmp-new-${++seq}`, task_id: "t-fixture", status: "queued" };
  if (method === "DELETE") { pairs = pairs.filter((p) => p.id !== m[1]); return { deleted: m[1] }; }
  pairs = pairs.map((p) => (p.id === m[1] ? { ...p, key_map: b.key_map ?? {} } : p));
  return pairs.find((p) => p.id === m[1]);
}
