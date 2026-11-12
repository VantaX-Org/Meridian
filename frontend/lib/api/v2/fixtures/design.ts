/** Source design fixture: one ECC discovery with two snapshots, three tables, Z fields and configuration deviation. */
export const NONE_DESIGN = Symbol("not a source design path");

const f = (name: string, type: string, length: number, extra: Record<string, unknown> = {}) => ({ name, type, length, decimals: 0, ...extra });
const std = (type: string, length: number, domain: string) => ({ type, length, decimals: 0, domain });

const TABLES = [
  { table: "MARA", description: "General material data", category: "TRANSP", delivery_class: "A", customer_table: false, field_count: 241, customer_fields: 3 },
  { table: "LFA1", description: "Vendor master (general section)", category: "TRANSP", delivery_class: "A", customer_table: false, field_count: 168, customer_fields: 1 },
  { table: "ZMM_PART_ATTR", description: "Komatsu part attributes", category: "TRANSP", delivery_class: "A", customer_table: true, field_count: 14, customer_fields: 14 },
];

const DETAIL: Record<string, unknown> = {
  MARA: {
    table: "MARA", description: "General material data", category: "TRANSP", delivery_class: "A", customer_table: false, in_sap_standard: true,
    fields: [
      { ...f("MATNR", "CHAR", 40, { key: true, check_table: null }), standard: std("CHAR", 40, "MATNR"), deviation: null },
      { ...f("MTART", "CHAR", 4, { check_table: "T134" }), standard: std("CHAR", 4, "MTART"), deviation: null },
      { ...f("MATKL", "CHAR", 18, { check_table: "T023" }), standard: std("CHAR", 9, "MATKL"), deviation: "differs_from_standard (CHAR 9 → CHAR 18)" },
      { ...f("ZZOEM_PART", "CHAR", 30, { customer_field: true }), standard: null, deviation: "customer_field" },
      { ...f("ZZCRITICAL", "CHAR", 1, { customer_field: true }), standard: null, deviation: "customer_field" },
      { ...f("ZZSUPERSEDED", "CHAR", 40, { customer_field: true, check_table: "MARA" }), standard: null, deviation: "customer_field" },
    ],
    standard_fields_missing: ["FSH_SEALV"],
  },
};

const SNAPSHOTS = [
  { id: "ds-2", status: "completed", started_at: "2026-10-28T01:00:00Z", completed_at: "2026-10-28T01:42:00Z", tables: 3, customer_tables: 1, customer_fields: 18, error: null },
  { id: "ds-1", status: "completed", started_at: "2026-09-30T01:00:00Z", completed_at: "2026-09-30T01:39:00Z", tables: 2, customer_tables: 0, customer_fields: 2, error: null },
];

export function designRead(path: string, params: Record<string, unknown> = {}): unknown {
  const m = /^\/systems\/[^/]+\/design(\/.*)?$/.exec(path);
  if (!m) return NONE_DESIGN;
  const sub = m[1] ?? "";
  if (sub === "") {
    return {
      system_type: "ecc", discovery_status: "completed", discovered_at: "2026-10-28T01:42:00Z", sap_release: "EHP8", sap_product: "ecc6",
      config_sync_status: "completed", config_synced_at: "2026-10-28T02:05:00Z",
      snapshot: { ...SNAPSHOTS[0], source: "rfc", coverage_summary: { covered: 2, partial: 1 } },
      configuration: [{ table: "T134", scope: "material_master", rows: 52, source: "live", synced_at: "2026-10-28T02:05:00Z" }],
    };
  }
  if (sub === "/tables") {
    const s = String(params.search ?? "").toUpperCase();
    const items = TABLES.filter((t) => (!s || t.table.includes(s) || t.description.toUpperCase().includes(s)) && (!params.customer_only || t.customer_table || t.customer_fields > 0));
    return { total: items.length, items };
  }
  const one = /^\/tables\/([^/]+)$/.exec(sub);
  if (one) {
    const name = decodeURIComponent(one[1]).toUpperCase();
    const row = TABLES.find((t) => t.table === name);
    if (!row) throw Object.assign(new Error("Table not in the discovery snapshot"), { status: 404, response: { status: 404 } });
    return DETAIL[name] ?? { ...row, in_sap_standard: !row.customer_table, fields: [], standard_fields_missing: [] };
  }
  if (sub === "/coverage") {
    return {
      snapshot_id: SNAPSHOTS[0].id,
      coverage: {
        dictionary: [
          { table: "DD02L", status: "live", rows: 1840 },
          { table: "DD03L", status: "live", rows: 21400 },
          { table: "DD04T", status: "failed", detail: "Not authorised to read the table" },
        ],
        configuration: [
          { table: "T134", status: "live", rows: 52 },
          { table: "T001W", status: "not_in_system" },
        ],
        extraction: [
          { table: "EMPEMPLOYMENT", status: "live", rows: 60 },
          { table: "PAYRESULT", status: "upload_required" },
        ],
      },
      waiting_for_data: { payroll_integration: 43, material_master: 0 },
    };
  }
  const cfg = /^\/config\/([^/]+)$/.exec(sub);
  if (cfg) {
    const name = decodeURIComponent(cfg[1]).toUpperCase();
    if (name !== "T134") throw Object.assign(new Error("No configuration snapshot for this table"), { status: 404, response: { status: 404 } });
    return {
      table: "T134", scope: "material_master", total: 52, source: "live", synced_at: "2026-10-28T02:05:00Z",
      rows: [{ MTART: "ROH", MTBEZ: "Raw materials" }, { MTART: "FERT", MTBEZ: "Finished products" }, { MTART: "ZCOM", MTBEZ: "Commissioned parts" }],
    };
  }
  if (sub === "/config-deviation") {
    return {
      tables: [
        { reference: "T134.MTART", live_count: 52, standard_count: 48, custom: ["ZCOM", "ZKIT", "ZREM", "ZSRV"], missing: [] },
        { reference: "T001W.WERKS", live_count: 9, standard_count: 1, custom: ["1100", "1200", "1300", "1400", "2100", "2200", "3100", "3200"], missing: ["0001"] },
        { reference: "T024.EKGRP", live_count: 12, standard_count: 12, custom: [], missing: [] },
      ],
    };
  }
  if (sub === "/snapshots") return SNAPSHOTS;
  if (sub === "/diff") {
    return {
      from: params.from_snapshot, to: params.to_snapshot,
      changes: [
        { table: "MARA", field: "MATKL", change: "field_changed", diff: { length: [9, 18] } },
        { table: "MARA", field: "ZZSUPERSEDED", change: "field_added" },
        { table: "ZMM_PART_ATTR", change: "table_added" },
      ],
    };
  }
  return NONE_DESIGN;
}

export function designWrite(method: string, path: string): unknown {
  if (method === "POST" && /^\/systems\/[^/]+\/discover$/.test(path)) return { task_id: "t-discover", status: "queued" };
  return NONE_DESIGN;
}
