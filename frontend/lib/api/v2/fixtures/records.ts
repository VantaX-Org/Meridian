/**
 * Fixture for the record sheet (api/routes/object_records.py) and the glossary batch lookup (api/routes/glossary.py):
 *   GET /objects/{object}/records/{key}, GET /objects/{object}/records/{key}/findings, POST /glossary/batch-lookup,
 *   GET /lineage/rule/{check_id} (api/routes/lineage.py)
 * Any key opens: the record is the key with a fixed material row, and it fails two shipped rules.
 */
export const NONE_RECORDS = Symbol("none-records");

const RECORD = /^\/objects\/([^/]+)\/records\/([^/]+)(\/findings)?$/;

export function recordsRead(path: string, params: Record<string, unknown>): unknown {
  if (path.startsWith("/lineage/rule/")) {
    const check_id = decodeURIComponent(path.slice("/lineage/rule/".length));
    return {
      check_id,
      module: "material_master",
      fields: ["MARA.MEINS", "MARA.MTART"],
      targets: ["T006.MSEHI"],
      tables: ["MARA", "T006"],
      joins: [{ parent: "MARA", child: "T006", on: [["MEINS", "MSEHI"]], cardinality: "many_to_one" }],
      glossary_terms: [{ id: "g-meins", business_name: "Base unit of measure", sap_table: "MARA", sap_field: "MEINS" }],
      owners: [{ kind: "object", ref: "material_master", owner_user_id: "u-1", owner_name: "Thandi Mokoena", steward_user_id: null, steward_name: null, updated_at: "2026-11-02T09:00:00Z" }],
    };
  }
  const m = RECORD.exec(path);
  if (!m) return NONE_RECORDS;
  const key = decodeURIComponent(m[2]);
  const version_id = typeof params.version_id === "string" ? params.version_id : "d3229ded-0708-4967-9dfb-1b7f4fada953";
  if (m[3]) {
    return {
      version_id,
      failing: [
        { check_id: "MM003", severity: "critical", message: "Base unit of measure is blank.", field: "MARA.MEINS" },
        { check_id: "MM142", severity: "medium", message: "Material group is not in the allowed list.", field: "MARA.MATKL" },
      ],
    };
  }
  return {
    matnr: key,
    description: "Hydraulic pump seal kit",
    mara: { MATNR: key, MTART: "ROH", MEINS: "", MATKL: "099", MBRSH: "M", ERSDA: "2019-04-11" },
    makt: [{ SPRAS: "E", MAKTX: "Hydraulic pump seal kit" }],
    marm: [], mean: [], marc: [], mvke: [], mbew: [], mard: [], mlgn: [],
    labels: { MTART: "Raw material", MBRSH: "Mechanical engineering" },
    expected_known: false,
    levels: [],
    levels_total: 0,
    views: [],
    phasing: { plants: 0, phasing_out: 0, with_followup: 0, plant: null, ausdt: null, nfmat: null, followup_description: null },
    version_id,
  };
}

const TERMS: Record<string, { id: string; business_name: string; business_definition: string }> = {
  "MARA.MTART": { id: "g-mtart", business_name: "Material type", business_definition: "Groups materials by how they are used." },
  "MARA.MEINS": { id: "g-meins", business_name: "Base unit of measure", business_definition: "The unit stock is kept in." },
};

export function recordsWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/glossary/batch-lookup") return NONE_RECORDS;
  const fields = (body as { fields?: string[] } | null)?.fields ?? [];
  return { lookup: Object.fromEntries(fields.filter((f) => TERMS[f]).map((f) => [f, TERMS[f]])) };
}
