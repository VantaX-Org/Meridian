/**
 * Reference data fixture, shaped like api/routes/reference_data.py. The codes are synthetic check-table values (units,
 * countries, payment terms, material groups, a SuccessFactors picklist); no master record value appears. Four eyes is
 * enforced as the route does: the fixture user ("u-me") cannot approve a mapping they proposed, a colleague's can be.
 */
import type { MappingStatus, ProposeBody, RefCode, RefCoverage, RefList, RefLists, RefListSummary, RefMapping, RefSuggestion } from "../reference-data";
import { systemsExtended } from "./runs";

export const NONE_REFERENCE_DATA = Symbol("not a reference data path");

const ME = "u-me";
const COLLEAGUE = "u-colleague";

const refuse = (status: number, detail: string): never => {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
};

interface Def { id: string; table: string; module: string; target_fields: string[]; source: RefCode[]; target: RefCode[]; versions: number[] }

const c = (code: string, text: string | null = null): RefCode => ({ code, text });

const DEFS: Def[] = [
  {
    id: "country", table: "T005", module: "sd_customer_master", target_fields: ["KNA1.LAND1"], versions: [8, 9, 9],
    source: [c("DE", "Germany"), c("ZA", "South Africa"), c("US", "United States"), c("UK", "United Kingdom"), c("YU", "Yugoslavia")],
    target: [c("DE", "Germany"), c("ZA", "South Africa"), c("US", "United States"), c("GB", "United Kingdom"), c("RS", "Serbia")],
  },
  {
    id: "payment_terms", table: "T052", module: "sd_customer_master", target_fields: ["KNB1.ZTERM"], versions: [4, 5, 6],
    source: [c("Z030", "30 days net"), c("Z045", "45 days net"), c("Z060", "60 days net")], target: [c("Z030", "30 days net"), c("ZB45", "45 days net"), c("ZB60", "60 days net")],
  },
  {
    id: "unit_of_measure", table: "T006", module: "material_master", target_fields: ["MARA.MEINS", "MARA.GEWEI"], versions: [11, 12, 12],
    source: [c("EA", "Each"), c("KG", "Kilogram"), c("LB", "Pound"), c("Z01", "Piece"), c("Z02", "Metre roll")],
    target: [c("EA", "Each"), c("KG", "Kilogram"), c("LB", "Pound"), c("PC", "Piece"), c("M", "Metre")],
  },
  {
    id: "material_group", table: "T023", module: "material_master", target_fields: ["MARA.MATKL"], versions: [20, 21, 22],
    source: [c("001", "Raw materials"), c("002", "Spare parts"), c("910", "Miscellaneous spares")], target: [c("001", "Raw materials"), c("002", "Spare parts"), c("100", "Consumables")],
  },
  {
    id: "picklist", table: "PickListValueV2", module: "employee_central", target_fields: ["PickListValueV2.externalCode"], versions: [2, 3],
    source: [c("employmentType/FT"), c("employmentType/PT"), c("employmentType/CONT")], target: [c("employmentType/FT"), c("employmentType/PT"), c("employmentType/TEMP")],
  },
];

const ORIGINS = ["Full extraction", "Configuration sync", "Full extraction"];

let seq = 0;
const mk = (list: string, field: string, s: string, t: string, status: MappingStatus, by: string, decidedBy: string | null = null): RefMapping & { list: string } => {
  const def = DEFS.find((d) => d.id === list) as Def;
  const text = (xs: RefCode[], code: string) => xs.find((x) => x.code === code)?.text ?? null;
  seq += 1;
  return {
    id: `rd-${seq}`, list, target_field: field, source_code: s, source_text: text(def.source, s), target_code: t, target_text: text(def.target, t), status,
    note: null, proposed_by: by, decided_by: decidedBy, decided_at: decidedBy ? "2026-11-02T09:30:00+00:00" : null,
  };
};

const seed = () => {
  seq = 0;
  return [
    mk("country", "KNA1.LAND1", "UK", "GB", "proposed", COLLEAGUE),
    mk("country", "KNA1.LAND1", "YU", "RS", "confirmed", COLLEAGUE, "u-approver"),
    mk("payment_terms", "KNB1.ZTERM", "Z045", "ZB45", "confirmed", COLLEAGUE, "u-approver"),
    mk("payment_terms", "KNB1.ZTERM", "Z060", "ZB60", "proposed", ME),
    mk("material_group", "MARA.MATKL", "910", "100", "rejected", COLLEAGUE, "u-approver"),
  ];
};

let maps = seed();
export const resetReferenceData = () => { maps = seed(); seq = maps.length; };

const isSf = (systemId: string): boolean => systemsExtended().find((s) => s.id === systemId)?.system_type === "successfactors";
const defsFor = (systemId: string): Def[] => {
  if (!systemsExtended().some((s) => s.id === systemId)) return refuse(404, "System not found");
  return DEFS.filter((d) => (d.module === "employee_central") === isSf(systemId));
};

function coverage(d: Def): RefCoverage {
  const by = new Map(maps.filter((m) => m.list === d.id).map((m) => [m.source_code, m.status]));
  const tgt = new Set(d.target.map((x) => x.code));
  const n: RefCoverage = { same: 0, approved: 0, proposed: 0, rejected: 0, open: 0 };
  for (const s of d.source) {
    const st = by.get(s.code);
    if (st === "confirmed") n.approved += 1;
    else if (st === "proposed") n.proposed += 1;
    else if (st === "rejected") n.rejected += 1;
    else if (tgt.has(s.code)) n.same += 1;
    else n.open += 1;
  }
  return n;
}

const strip = (m: RefMapping & { list?: string }): RefMapping => {
  const { list: _list, ...rest } = m;
  void _list;
  return rest;
};

export function referenceDataRead(path: string, params: Record<string, unknown>): unknown {
  const sys = String(params.system_id ?? "");
  if (path === "/reference-data/lists") {
    const lists: RefListSummary[] = defsFor(sys).map((d) => ({
      id: d.id, table: d.table, module: d.module, target_fields: d.target_fields, source_codes: d.source.length, target_codes: d.target.length,
      versions: d.versions.length, coverage: coverage(d),
    }));
    return { target_label: "S/4HANA baseline", lists } satisfies RefLists;
  }
  const m = /^\/reference-data\/lists\/([^/]+)$/.exec(path);
  if (!m) return NONE_REFERENCE_DATA;
  const d = defsFor(sys).find((x) => x.id === m[1]);
  if (!d) return refuse(404, "Unknown code list");
  const versions = d.versions.map((codes, i) => ({ load_id: `load-${d.id}-${i + 1}`, origin: ORIGINS[i % ORIGINS.length], finished_at: `2026-10-${String(10 + i * 7).padStart(2, "0")}T04:00:00+00:00`, codes })).reverse();
  return {
    id: d.id, table: d.table, module: d.module, target_fields: d.target_fields, target_label: "S/4HANA baseline", version_id: versions[0].load_id, versions,
    source: d.source, target: d.target, mappings: maps.filter((x) => x.list === d.id).map(strip), coverage: coverage(d),
  } satisfies RefList;
}

/** A suggestion is proved the way the route proves one: the target code must be in the target list. */
function suggestion(d: Def, source: string): RefSuggestion | null {
  const s = d.source.find((x) => x.code === source);
  const hit = s?.text ? d.target.find((x) => x.text?.toLowerCase() === s.text?.toLowerCase() && x.code !== source) : undefined;
  if (!s || !hit) return null;
  return {
    source_code: source, target_code: hit.code, target_text: hit.text, confidence: 0.86, reasoning: `${hit.code} is in the target list as ${hit.text}.`,
    checks: [{ code: "SOURCE_KNOWN", passed: true }, { code: "TARGET_EXISTS", passed: true }, { code: "CONFIDENCE_VALID", passed: true }],
  };
}

export function referenceDataWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST") return NONE_REFERENCE_DATA;
  if (path === "/reference-data/mappings") {
    const b = body as ProposeBody;
    const d = defsFor(b.system_id).find((x) => x.id === b.list_id);
    if (!d) return refuse(404, "Unknown code list");
    if (!d.target_fields.includes(b.target_field)) return refuse(422, `${b.target_field} is not checked by this list`);
    if (!d.source.some((x) => x.code === b.source_code)) return refuse(422, `${b.source_code} is not a source code of this list`);
    if (!d.target.some((x) => x.code === b.target_code)) return refuse(422, `${b.target_code} is not a target code of this list`);
    maps = maps.filter((x) => !(x.list === d.id && x.source_code === b.source_code && x.target_field === b.target_field));
    const row = mk(d.id, b.target_field, b.source_code, b.target_code, "proposed", ME);
    row.note = b.note ?? null;
    maps.push(row);
    return strip(row);
  }
  const m = /^\/reference-data\/mappings\/([^/]+)\/decision$/.exec(path);
  if (m) {
    const row = maps.find((x) => x.id === m[1]);
    if (!row) return refuse(404, "Mapping not found");
    if (row.status !== "proposed") return refuse(409, "Only a proposed mapping can be decided");
    if (row.proposed_by === ME) return refuse(403, "Four eyes: the user who proposed a mapping cannot decide it");
    const approve = (body as { decision: string }).decision === "approve";
    row.status = approve ? "confirmed" : "rejected";
    row.decided_by = ME;
    row.decided_at = "2026-11-04T08:00:00+00:00";
    return { id: row.id, status: row.status };
  }
  if (path === "/reference-data/suggest") {
    const b = body as { system_id: string; list_id: string; source_code: string };
    const d = defsFor(b.system_id).find((x) => x.id === b.list_id);
    if (!d) return refuse(404, "Unknown code list");
    return { suggestion: suggestion(d, b.source_code) };
  }
  return NONE_REFERENCE_DATA;
}
