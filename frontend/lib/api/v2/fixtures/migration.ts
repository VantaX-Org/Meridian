/**
 * Migration analysis fixture, shaped like api/routes/migration.py: two analyses of the ECC production material and
 * business partner data against S/4HANA, their gaps, the records that will not load, and an editable field map and
 * value map. Writes change the in-memory map until the page reloads.
 */
import type { FieldMapping, TargetTemplate, ValueEntry, WorkbookReport } from "../migration";

const refuse = (detail: string, code = 409): never => {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
};

export const NONE_MIGRATION = Symbol("not a migration path");

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const S4 = "a1b2c3d4-0002-4000-8000-000000000002";

let runs = [
  {
    id: "mig-0002", mode: "source_to_destination", source_system_id: ECC, dest_system_id: S4, source_version_id: "v-mm",
    target_release: "s4hana", target_connected: true, modules: ["material_master", "business_partner"], status: "analysed",
    readiness_verdict: "no-go", readiness_score: 87.4, critical_count: 3, records_total: 48_210, records_blocked: 6_071,
    error_detail: null, created_at: "2026-10-30T06:12:00Z", completed_at: "2026-10-30T06:41:00Z",
  },
  {
    id: "mig-0001", mode: "s4_dry_run", source_system_id: ECC, dest_system_id: null, source_version_id: "v-mm",
    target_release: "s4hana", target_connected: false, modules: ["material_master"], status: "analysed",
    readiness_verdict: "conditional", readiness_score: 92.1, critical_count: 0, records_total: 31_500, records_blocked: 2_488,
    error_detail: null, created_at: "2026-10-22T09:03:00Z", completed_at: "2026-10-22T09:20:00Z",
  },
  {
    id: "mig-0003", mode: "source_to_destination", source_system_id: ECC, dest_system_id: S4, source_version_id: "v-mm",
    target_release: "s4hana", target_connected: true, modules: ["material_master"], status: "analysed",
    readiness_verdict: "conditional", readiness_score: 90.3, critical_count: 0, records_total: 12_000, records_blocked: 410,
    error_detail: null, created_at: "2026-10-20T07:00:00Z", completed_at: "2026-10-20T07:12:00Z",
  },
];

const gaps = [
  { module: "material_master", gap_type: "value_unmapped", severity: "critical", grounded: true, n: 3_120, records: 2_904, fields: 2 },
  { module: "material_master", gap_type: "length_truncation", severity: "high", grounded: true, n: 1_412, records: 1_412, fields: 1 },
  { module: "material_master", gap_type: "obsolete_target", severity: "critical", grounded: true, n: 2, records: 0, fields: 2 },
  { module: "business_partner", gap_type: "key_collision", severity: "critical", grounded: true, n: 214, records: 428, fields: 1 },
  { module: "business_partner", gap_type: "check_table_value", severity: "medium", grounded: true, n: 1_327, records: 1_327, fields: 1 },
  { module: "material_master", gap_type: "unmapped_field", severity: "low", grounded: false, n: 18, records: 0, fields: 18 },
];

const findings = [
  { module: "material_master", source_table: "MARA", record_key: "000000000010004711", source_field: "MARA.MTART", source_value: "ZROH", dest_table: "MARA", target_field: "MARA.MTART", target_value: null, gap_type: "value_unmapped", severity: "critical", detail: "ZROH is not a material type in the target and has no value map entry.", provenance: "target_dictionary", grounded: true },
  { module: "material_master", source_table: "MARA", record_key: "000000000010004712", source_field: "MARA.MTART", source_value: "ZROH", dest_table: "MARA", target_field: "MARA.MTART", target_value: null, gap_type: "value_unmapped", severity: "critical", detail: "ZROH is not a material type in the target and has no value map entry.", provenance: "target_dictionary", grounded: true },
  { module: "material_master", source_table: "MAKT", record_key: "000000000010009001", source_field: "MAKT.MAKTX", source_value: "Hydraulic hose assembly 3/4in 2-wire braid 1.2m with crimped fittings", dest_table: "MAKT", target_field: "MAKT.MAKTX", target_value: "Hydraulic hose assembly 3/4in 2-wire", gap_type: "length_truncation", severity: "high", detail: "The value is 70 characters; the target field holds 40.", provenance: "target_dictionary", grounded: true },
  { module: "material_master", source_table: "MARA", record_key: null, source_field: "MARA.ZZOLD", source_value: null, dest_table: "MARA", target_field: "MARA.ZZOLD", target_value: null, gap_type: "obsolete_target", severity: "critical", detail: "The field does not exist in the target release.", provenance: "target_dictionary", grounded: true },
  { module: "business_partner", source_table: "KNA1", record_key: "0000100234", source_field: "KNA1.KUNNR", source_value: "0000100234", dest_table: "BUT000", target_field: "BUT000.PARTNER", target_value: "0000100234", gap_type: "key_collision", severity: "critical", detail: "A supplier with the same number becomes the same business partner.", provenance: "target_dictionary", grounded: true },
  { module: "business_partner", source_table: "KNA1", record_key: "0000100871", source_field: "KNA1.LAND1", source_value: "UK", dest_table: "BUT020", target_field: "ADRC.COUNTRY", target_value: null, gap_type: "check_table_value", severity: "medium", detail: "UK is not in check table T005; the target expects GB.", provenance: "target_config", grounded: true },
];

const records = [
  { module: "material_master", source_table: "MARA", record_key: "000000000010004711", status: "load_fail", reasons: ["MARA.MTART: ZROH has no target value"] },
  { module: "material_master", source_table: "MARA", record_key: "000000000010004712", status: "load_fail", reasons: ["MARA.MTART: ZROH has no target value"] },
  { module: "business_partner", source_table: "KNA1", record_key: "0000100234", status: "load_fail", reasons: ["Business partner number collides with supplier 0000100234"] },
  { module: "material_master", source_table: "MARA", record_key: "000000000010000001", status: "load_ready", reasons: [] },
  { module: "material_master", source_table: "MARA", record_key: "000000000010000002", status: "load_ready", reasons: [] },
];

const def = (type: string, length: number, description: string, check_table: string | null = null) => ({ type, length, decimals: 0, check_table, description });
let fieldMap: FieldMapping[] = [
  { id: "fm-1", module: "material_master", source_field: "MARA.MTART", dest_system_type: "s4hana", dest_table: "MARA", dest_field: "MTART", value_map: true, origin: "identity", transform_note: null, is_confirmed: true, source_def: def("CHAR", 4, "Material type", "T134"), target_def: def("CHAR", 4, "Material type", "T134") },
  { id: "fm-2", module: "material_master", source_field: "MAKT.MAKTX", dest_system_type: "s4hana", dest_table: "MAKT", dest_field: "MAKTX", value_map: false, origin: "sap_standard", transform_note: "Shorten to 40 characters", is_confirmed: false, source_def: def("CHAR", 70, "Material description (legacy Z length)"), target_def: def("CHAR", 40, "Material description") },
  { id: "fm-3", module: "material_master", source_field: "MARA.ZZOLD", dest_system_type: "s4hana", dest_table: null, dest_field: null, value_map: false, origin: "steward", transform_note: "Not migrated", is_confirmed: true, source_def: def("CHAR", 10, "Old material reference"), target_def: null },
  { id: "fm-4", module: "material_master", source_field: "MARC.PLIFZ", dest_system_type: "s4hana", dest_table: "MARC", dest_field: "PLIFZ", value_map: false, origin: "identity", transform_note: null, is_confirmed: false, source_def: def("NUMC", 3, "Planned delivery time in days"), target_def: def("DEC", 3, "Planned delivery time in days") },
];
let valueMap: ValueEntry[] = [
  { id: "vm-1", target_field: "MARA.MTART", source_value: "ZFRT", target_value: "FERT", note: "Finished goods", updated_at: "2026-10-28T10:00:00Z", status: "confirmed", proposed_by: "u-steward", decided_by: "u-owner" },
  { id: "vm-2", target_field: "MARA.MTART", source_value: "ZROH", target_value: "ROH", note: "Raw materials", updated_at: "2026-11-02T09:00:00Z", status: "proposed", proposed_by: "u-steward", decided_by: null },
];

const field = (f: string, description: string, compared: number, differing: number) => ({ field: f, description, in_target_extract: true, compared, matched: compared - differing, differing });
const reconTables = [
  { table: "MARA", description: "General material data", comparable: true, reason: null, key_fields: ["MATNR"], expected: 41_990, found: 41_902, missing: 88, unexpected: 3, duplicate_expected: 0, duplicate_found: 0, capped: true, records_total: { missing: 88, differing: 143, unexpected: 3 },
    fields: [field("MTART", "Material type", 41_990, 61), field("MATKL", "Material group", 41_990, 12), field("MEINS", "Base unit of measure", 41_990, 0)] },
  { table: "MAKT", description: "Material descriptions", comparable: true, reason: null, key_fields: ["MATNR", "SPRAS"], expected: 41_990, found: 41_880, missing: 110, unexpected: 0, duplicate_expected: 0, duplicate_found: 0, capped: true, records_total: { missing: 110, differing: 70, unexpected: 0 },
    fields: [field("MAKTX", "Material description", 41_990, 70)] },
  { table: "MARC", description: "Plant data for material", comparable: false, reason: "target_extract_partial", key_fields: ["MATNR", "WERKS"], expected: 0, found: 0, missing: 0, unexpected: 0, duplicate_expected: 0, duplicate_found: 0, capped: false, records_total: { missing: 0, differing: 0, unexpected: 0 }, fields: [] },
];
const reconRecords = [
  { kind: "missing", key: "MATNR=000000000010004801", source_record: "MARA:000000000010004801", field: null, expected: null, found: null },
  { kind: "missing", key: "MATNR=000000000010004802", source_record: "MARA:000000000010004802", field: null, expected: null, found: null },
  { kind: "differing", key: "MATNR=000000000010004711", source_record: "MARA:000000000010004711", field: "MTART", expected: "ROH", found: "HALB" },
  { kind: "differing", key: "MATNR=000000000010009001|SPRAS=E", source_record: "MAKT:000000000010009001", field: "MAKTX", expected: "Hydraulic hose assembly 3/4in 2-wire", found: "Hydraulic hose assembly 3/4in 2-wi" },
  { kind: "differing", key: "LIFNR=0000100234", source_record: "LFA1:0000100234", field: "NAME1", expected: null, found: null, withheld: true },
  { kind: "unexpected", key: "MATNR=000000000010004711", source_record: "MARA:000000000010004711", field: null, expected: null, found: null },
] as const;
const recon = {
  reconciliation_id: "rec-0001", run_id: "mig-0002", status: "done", error_detail: null, target_system_id: S4, target_version_id: "v-s4-3",
  target_synced_at: "2026-11-02T04:10:00Z", created_at: "2026-11-02T06:00:00Z", completed_at: "2026-11-02T06:04:00Z", stale: false,
  latest_target_synced_at: "2026-11-02T04:10:00Z", record_cap: 100,
  summary: { tables: 3, comparable: 2, expected: 83_980, found: 83_782, missing: 198, unexpected: 3, differing_fields: 143, basis: "snapshot", snapshot_export_id: "exp-0001", snapshot_exported_at: "2026-11-01T09:30:00Z" },
  automatic: true,
  previous: { created_at: "2026-10-28T06:00:00Z", summary: { tables: 3, comparable: 2, expected: 83_980, found: 83_541, missing: 439, unexpected: 3, differing_fields: 201 } },
  tables: reconTables,
  scores: [
    { module: "material_master", source: 78.2, projected: 91.4, actual: 88.9, actual_reason: null, reasons: [
      { check_id: "MM-MTART-001", description: "Material type exists in the target", severity: "high", dimension: "validity", source_pass_rate: 93.1, target_pass_rate: 99.8, change: 6.7 },
      { check_id: "MM-MAKTX-004", description: "Description fits the target field length", severity: "medium", dimension: "completeness", source_pass_rate: 96.6, target_pass_rate: 99.7, change: 3.1 },
    ] },
    { module: "business_partner", source: 81.0, projected: 90.2, actual: null, actual_reason: "no_target_findings_for_module", reasons: [] },
  ],
};
/** A reconciliation that failed because the target system was never extracted. */
const reconNoTarget = {
  ...recon, reconciliation_id: "rec-0003", run_id: "mig-0003", status: "failed", error_detail: "The target system has no completed analysis. Extract the target first.",
  needs_target_extraction: true, target_system_id: null, target_version_id: null, target_synced_at: null, completed_at: null, automatic: false, previous: null, summary: {}, tables: [], scores: [],
};
/** A check of a target workbook: one sheet filled with a held row, one short of a required column, one not filled. */
export const fixtureWorkbookReport = (): WorkbookReport => ({
  summary: { sheets: 3, filled_sheets: 2, columns: 24, matched_columns: 11, mandatory_unmapped: 2, rows: 120, ready: 118, held: 2, mandatory_sheets_empty: 0, mapped_values: 14 },
  format: { id: "xlsx", same: true, written_as: "zip", skipped: [] },
  country_unchecked: [{ sheet: "Biographical Information", id: "national-id", label: "National ID" }],
  sheets: [
    { name: "Biographical Information", kind: "definition", table: "PERPERSON", columns: 8, added_keys: ["personIdExternal"], matched: 6, rows: 60, ready: 59, held: 1, known: true, unmapped: [{ id: "country-of-birth", label: "Country Of Birth", mandatory: false }] },
    { name: "Job Information", kind: "definition", table: "EMPJOB", columns: 12, added_keys: ["userId"], matched: 5, rows: 60, ready: 59, held: 1, known: true, unmapped: [{ id: "event-reason", label: "Event Reason", mandatory: true }, { id: "pay-grade", label: "Pay Grade", mandatory: true, learned: true }, { id: "seniority-band", label: "Seniority Band", mandatory: false, not_in_system: true }, { id: "ZZGRADE", label: "Grade code", mandatory: false, candidates: ["PA0001", "PA0008"] }] },
    { name: "Social Accounts", kind: "definition", table: null, columns: 4, added_keys: [], matched: 0, rows: 0, ready: 0, held: 0, known: false, unmapped: [] },
  ],
  reasons: { too_long: 1, bad_date: 1 },
  held: [
    { sheet: "Biographical Information", record: "EMP-0001", field: "Date Of Birth", reason: "bad_date" },
    { sheet: "Job Information", record: "EMP-0002", field: "Job Title", reason: "too_long" },
  ],
  held_total: 2,
  learned: { new: 1, waiting: 1, missing: 1, system_id: "sys-sf", modules: ["employee_central"] },
});
/** One kept template: a synthetic cockpit file with one column the dictionary did not resolve. */
let templates: TargetTemplate[] = [{
  id: "tpl-0001", name: "Material cockpit", version: 2, filename: "material_cockpit.xlsx", size_bytes: 48_211,
  coverage: { columns: 5, matched: 4, sheets: [{ name: "Basic Data", table: "MARA", columns: 5, matched: 4, unmapped: [{ header: "Legacy group", id: "Legacy group", label: "Legacy group", mandatory: false }] }] },
  column_map: {}, last_fill_at: "2026-11-02T10:00:00Z", last_fill_version_id: "v-0001", created_by: "u-me", created_at: "2026-11-01T09:00:00Z",
}];
const templateFields = [
  { field: "MARA.MATKL", description: "Material Group", key: false, table_description: "General Material Data" },
  { field: "MARA.MATNR", description: "Material Number", key: true, table_description: "General Material Data" },
];
let seq = 10;

export function migrationRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/migration/runs") return { runs };
  const m = /^\/migration\/runs\/([^/]+)(\/.+)?$/.exec(path);
  if (m) {
    const r = runs.find((x) => x.id === m[1]);
    if (!r) return NONE_MIGRATION;
    const rest = m[2] ?? "";
    if (rest === "") return { run: r, gap_breakdown: r.id === "mig-0002" ? gaps : gaps.filter((g) => g.module === "material_master" && g.gap_type !== "obsolete_target"), structural_critical: r.id === "mig-0002" ? 2 : 0 };
    if (rest === "/findings") {
      const q = String(params.search ?? "").toLowerCase();
      const items = findings.filter((f) => (!params.module || f.module === params.module) && (!params.gap_type || f.gap_type === params.gap_type) && (!params.severity || f.severity === params.severity) && (!q || JSON.stringify(f).toLowerCase().includes(q)));
      const off = Number(params.offset ?? 0);
      return { total: items.length, items: items.slice(off, off + Number(params.limit ?? 50)) };
    }
    if (rest === "/records") {
      const rows = records.filter((x) => x.status === params.status);
      return { total: params.status === "load_fail" ? r.records_blocked : (r.records_total ?? 0) - (r.records_blocked ?? 0), rows };
    }
    if (rest === "/reconciliation") return r.id === "mig-0002" ? recon : r.id === "mig-0003" ? reconNoTarget : NONE_MIGRATION;
    if (rest === "/reconciliation/records" && r.id === "mig-0002") {
      const rows = reconRecords.filter((x) => (!params.kind || x.kind === params.kind) && (!params.table || x.source_record.startsWith(`${params.table}:`)));
      return { table: params.table ?? null, kind: params.kind ?? null, total: rows.length, capped: true, record_cap: 100, rows };
    }
    if (rest === "/value-candidates") return { target_field: params.target_field, values: [{ source_value: "ZROH", records: 2_904 }, { source_value: "ZFRT", records: 611 }, { source_value: "HALB", records: 4_020 }] };
    return NONE_MIGRATION;
  }
  const tp = /^\/migration\/templates\/([^/]+)(\/fields)?$/.exec(path);
  if (tp) return tp[2] ? { fields: templateFields } : { module: tp[1], templates: tp[1] === "material_master" ? templates : [] };
  if (path === "/migration/field-map") return { mappings: fieldMap.filter((f) => (!params.module || f.module === params.module) && (!params.dest_system_type || f.dest_system_type === params.dest_system_type)) };
  if (path === "/migration/value-map") return { entries: valueMap.filter((v) => !params.target_field || v.target_field === params.target_field) };
  return NONE_MIGRATION;
}

export function migrationWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && path === "/migration/analyze") return { run_id: `mig-${++seq}`, task_id: "t-fixture", status: "queued", mode: b.mode, modules: b.modules };
  if (method === "POST" && /^\/migration\/runs\/[^/]+\/reconcile$/.test(path)) return { reconciliation_id: "rec-0002", task_id: "t-fixture", status: "queued" };
  const ex = /^\/migration\/runs\/([^/]+)\/extract-target$/.exec(path);
  if (method === "POST" && ex) return { job_id: "dl-fixture", version_id: "v-fixture", status: "queued", modules: runs.find((x) => x.id === ex[1])?.modules ?? [] };
  const rd = /^\/migration\/runs\/([^/]+)$/.exec(path);
  if (method === "DELETE" && rd) { runs = runs.filter((x) => x.id !== rd[1]); return {}; }
  const tm = /^\/migration\/templates\/[^/]+\/([^/]+)\/(mapping|check)$/.exec(path);
  if (tm && method === "PUT") {
    const cols = (b.columns ?? {}) as Record<string, string>;
    templates = templates.map((x) => {
      if (x.id !== tm[1] || !x.coverage) return x;
      const sheets = x.coverage.sheets.map((sh) => { const left = sh.unmapped.filter((u) => !cols[`${sh.name}::${u.header}`]); return { ...sh, matched: sh.columns - left.length, unmapped: left }; });
      return { ...x, column_map: { ...x.column_map, ...cols }, coverage: { ...x.coverage, matched: sheets.reduce((n, sh) => n + sh.matched, 0), sheets } };
    });
    const t = templates.find((x) => x.id === tm[1]);
    return { column_map: t?.column_map ?? {}, coverage: t?.coverage };
  }
  if (tm && method === "POST") return { ...fixtureWorkbookReport(), version_id: "v-0001", cleansed: { approved: 3, cells_changed: 3, by_field: { "MARA.MTART": 3 } } };
  if (method === "POST" && path === "/migration/field-map/seed") return { seeded: 0, module: b.module, dest_system_type: b.dest_system_type };
  if (method === "POST" && path === "/migration/field-map") {
    const row = { id: `fm-${++seq}`, module: String(b.module), source_field: String(b.source_field), dest_system_type: String(b.dest_system_type), dest_table: (b.dest_table as string) ?? null, dest_field: (b.dest_field as string) ?? null, value_map: false, origin: "steward", transform_note: (b.transform_note as string) ?? null, is_confirmed: false, source_def: null, target_def: null };
    fieldMap = [...fieldMap, row];
    return row;
  }
  const fm = /^\/migration\/field-map\/([^/]+)$/.exec(path);
  if (fm && method === "PUT") {
    fieldMap = fieldMap.map((f) => (f.id === fm[1] ? { ...f, ...(b as object) } : f));
    return fieldMap.find((f) => f.id === fm[1]);
  }
  if (fm && method === "DELETE") { fieldMap = fieldMap.filter((f) => f.id !== fm[1]); return { deleted: true }; }
  if (method === "PUT" && path === "/migration/value-map") {
    const entries = (b.entries ?? []) as { source_value: string; target_value: string; note?: string }[];
    for (const e of entries) {
      valueMap = [...valueMap.filter((v) => !(v.target_field === b.target_field && v.source_value === e.source_value)),
        { id: `vm-${++seq}`, target_field: String(b.target_field), source_value: e.source_value, target_value: e.target_value, note: e.note ?? null, updated_at: new Date().toISOString(), status: "proposed", proposed_by: "u-me", decided_by: null }];
    }
    return { saved: entries.length, status: "proposed" };
  }
  const vd = /^\/migration\/value-map\/([^/]+)\/decision$/.exec(path);
  if (vd && method === "POST") {
    const e = valueMap.find((v) => v.id === vd[1]);
    if (!e) return refuse("Value map entry not found", 404);
    if (e.status !== "proposed") return refuse("This value map entry is not waiting for a decision");
    if (e.proposed_by === "u-me") return refuse("A different user must approve this value map entry", 403);
    const to = b.decision === "approve" ? "confirmed" : "rejected";
    valueMap = to === "rejected" ? valueMap.filter((v) => v.id !== e.id) : valueMap.map((v) => (v.id === e.id ? { ...v, status: "confirmed", decided_by: "u-me" } : v));
    return { id: e.id, status: to };
  }
  const vm = /^\/migration\/value-map\/([^/]+)$/.exec(path);
  if (vm && method === "DELETE") { valueMap = valueMap.filter((v) => v.id !== vm[1]); return { deleted: true }; }
  return NONE_MIGRATION;
}
