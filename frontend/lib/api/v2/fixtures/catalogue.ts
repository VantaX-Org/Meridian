/**
 * Data catalogue fixture, shaped like api/routes/catalogue.py. The tables, their fields, types, descriptions, the
 * rules that read each field and the lineage below them are the real ones: catalogue.json was written from the SAP
 * dictionary bundle, the shipped rule YAML and the lineage model (a few fields per table, at most six rules per field).
 * What belongs to a tenant is added here: the demo landscape's three systems, the glossary terms of the MDM fixture,
 * the owners of Material master, a profile of ECC production's newest Material master run and one customer table
 * that only ECC production's own dictionary knows.
 */
import catalogueJson from "./catalogue.json";
import landscapeJson from "./landscape.json";
import type { CatalogueField, CatalogueFieldHit, CatalogueFields, CatalogueOwner, CatalogueSystem, CatalogueTable, CatalogueTableRow, CatalogueTables, CatalogueTerm } from "../catalogue";
import type { Landscape } from "../types";

export const NONE_CATALOGUE = Symbol("not a catalogue path");

type Raw = Omit<CatalogueTable, "systems" | "owners"> & { rule_count: number; systems: string[] };

const landscape = landscapeJson as unknown as Landscape;
const ECC = landscape.systems[0].id;
const RUN = landscape.cells.find((c) => c.system_id === ECC && c.module === "material_master")?.run_id ?? "";

const SYSTEMS: CatalogueSystem[] = landscape.systems.map((s) => ({ id: s.id, name: s.name, system_type: s.system_type, is_active: true }));

/** The glossary terms of the MDM fixture (fixtures/mdm.ts), by TABLE.FIELD. */
const TERMS: Record<string, CatalogueTerm[]> = {
  "MARA.MEINS": [{ id: "gt-meins", business_name: "Base unit of measure", status: "active", steward_name: "A. Naidoo" }],
  "MARA.MTART": [{ id: "gt-mtart", business_name: "Material type", status: "active", steward_name: "A. Naidoo" }],
  "MARA.MATKL": [{ id: "gt-matkl", business_name: "Material group", status: "under_review", steward_name: null }],
  "MARA.BRGEW": [{ id: "gt-brgew", business_name: "Gross weight", status: "active", steward_name: "A. Naidoo" }],
  "MARC.EKGRP": [{ id: "gt-ekgrp", business_name: "Purchasing group", status: "under_review", steward_name: null }],
  "MARC.DISMM": [{ id: "gt-dismm", business_name: "MRP type", status: "active", steward_name: "A. Naidoo" }],
};

const OWNERS: CatalogueOwner[] = [{ kind: "object", ref: "material_master", owner_name: "T. van der Merwe", steward_name: "A. Naidoo" }];

/** Blank and distinct counts of the newest Material master run of ECC production (61,816 materials). */
const PROFILE: Record<string, [blank: number, distinct: number, minLen: number, maxLen: number]> = {
  "MARA.MATNR": [0, 61816, 18, 18],
  "MARA.MTART": [0, 9, 4, 4],
  "MARA.MBRSH": [0, 4, 1, 1],
  "MARA.MATKL": [4120, 212, 3, 9],
  "MARA.MEINS": [312, 27, 2, 3],
  "MARA.BRGEW": [9870, 4310, 1, 9],
  "MARA.GEWEI": [9870, 6, 2, 3],
  "MARA.ERSDA": [0, 3104, 8, 8],
  "MARA.LAEDA": [1210, 2877, 8, 8],
  "MARA.LVORM": [60488, 1, 1, 1],
  "MAKT.MATNR": [0, 61816, 18, 18],
  "MAKT.MAKTX": [742, 58210, 3, 40],
};
const PROFILE_ROWS = 61816;

/** A table only ECC production's own dictionary holds: a customer extension read by discovery. */
const CUSTOMER: Raw = {
  table: "ZMM_PLANT_EXT",
  description: "Plant extension for materials (customer table)",
  source: "live",
  category: "TRANSP",
  delivery_class: "A",
  keys: ["MATNR", "WERKS"],
  note: null,
  obsolete_in: null,
  system: ECC,
  objects: [],
  rule_count: 0,
  systems: [ECC],
  fields: [
    ["MATNR", "Material number", "CHAR", 18, true],
    ["WERKS", "Plant", "CHAR", 4, true],
    ["ZZHAZCLASS", "Hazard class for storage", "CHAR", 4, false],
    ["ZZSHELFDAYS", "Shelf life in days at this plant", "NUMC", 4, false],
  ].map(([field, description, type, length, key]) => ({
    field: field as string, description: description as string, type: type as string, length: length as number, decimals: 0, key: key as boolean,
    data_element: null, domain: null, check_table: null, check_field: null, source: null, provenance: "live", fixed_values: [], help: null,
    mandatory: null, processes: [], tcodes: [], rules: [], terms: [], profile: null, lineage_node: null, downstream: [],
  })),
};

function withTenant(t: Raw): Raw {
  const fields: CatalogueField[] = t.fields.map((f) => {
    const id = `${t.table}.${f.field}`;
    const p = PROFILE[id];
    return {
      ...f,
      terms: TERMS[id] ?? [],
      profile: p
        ? {
            version_id: RUN, system_id: ECC, module: "material_master", run_at: "2026-11-10T02:14:00+00:00",
            stats: { rows: PROFILE_ROWS, table_rows: PROFILE_ROWS, sampled: false, blank: p[0], blank_pct: Math.round((p[0] / PROFILE_ROWS) * 10000) / 100, distinct: p[1], min_length: p[2], max_length: p[3], masked: true },
          }
        : null,
    };
  });
  // the count of rules the fixture lists, so the table row and its fields agree
  const rules = new Set(fields.flatMap((f) => f.rules.map((r) => `${r.check_id}/${r.module}`)));
  return { ...t, fields, rule_count: rules.size };
}

const TABLES: Raw[] = [...(catalogueJson as unknown as { tables: Raw[] }).tables.map(withTenant), CUSTOMER];
const byName = new Map(TABLES.map((t) => [t.table, t]));

const row = (t: Raw): CatalogueTableRow => ({
  table: t.table, description: t.description, source: t.source, category: t.category ?? null, field_count: t.fields.length,
  customer_table: t.source === "live", objects: t.objects, rule_count: t.rule_count, systems: t.systems,
});

const has = (needle: string, ...hay: (string | null | undefined)[]) => hay.some((h) => (h ?? "").toLowerCase().includes(needle));
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

class NotFound extends Error {
  status = 404;
}

function tables(params: Record<string, unknown>): CatalogueTables {
  const needle = str(params.q).trim().toLowerCase();
  const system = str(params.system);
  if (system && !SYSTEMS.some((s) => s.id === system)) throw new NotFound("System not found");
  const limit = Number(params.limit ?? 50) || 50;
  const offset = Number(params.offset ?? 0) || 0;
  const rank = (n: string) => (!needle ? 0 : n.toLowerCase() === needle ? 0 : n.toLowerCase().startsWith(needle) ? 1 : 2);
  const rows = TABLES.filter((t) => !needle || has(needle, t.table, t.description))
    .filter((t) => !system || t.systems.includes(system))
    .map(row)
    .sort((a, b) => rank(a.table) - rank(b.table) || b.rule_count - a.rule_count || a.table.localeCompare(b.table));
  return { total: rows.length, limit, offset, systems: SYSTEMS, tables: rows.slice(offset, offset + limit) };
}

function table(name: string, params: Record<string, unknown>): CatalogueTable {
  const t = byName.get(name.toUpperCase());
  const system = str(params.system);
  if (!t || (system && !t.systems.includes(system))) throw new NotFound("Table not in the catalogue");
  const { rule_count: _count, systems, ...rest } = t;
  void _count;
  return {
    ...rest,
    system: system || t.system || null,
    systems: SYSTEMS.filter((s) => systems.includes(s.id)),
    owners: t.objects.includes("material_master") ? OWNERS : [],
  };
}

function fields(params: Record<string, unknown>): CatalogueFields {
  const needle = str(params.q).trim().toLowerCase();
  const system = str(params.system);
  const hits: CatalogueFieldHit[] = [];
  for (const t of TABLES) {
    if (system && !t.systems.includes(system)) continue;
    for (const f of t.fields) {
      if (!has(needle, f.field, `${t.table}.${f.field}`, `${t.table}-${f.field}`, f.description, ...f.terms.map((x) => x.business_name))) continue;
      hits.push({ table: t.table, field: f.field, table_description: t.description, description: f.description, type: f.type ?? null, length: f.length, key: f.key, rule_count: f.rules.length, terms: f.terms });
    }
  }
  const rank = (h: CatalogueFieldHit) => {
    const f = h.field.toLowerCase();
    const names = [f, `${h.table}.${h.field}`.toLowerCase(), `${h.table}-${h.field}`.toLowerCase()];
    return names.includes(needle) ? 0 : names.some((n) => n.startsWith(needle)) ? 1 : 2;
  };
  hits.sort((a, b) => rank(a) - rank(b) || b.rule_count - a.rule_count || a.table.localeCompare(b.table) || a.field.localeCompare(b.field));
  const limit = Number(params.limit ?? 50) || 50;
  return { total: hits.length, limit, fields: hits.slice(0, limit) };
}

export function catalogueRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/catalogue/tables") return tables(params);
  if (path === "/catalogue/fields") {
    if (str(params.q).trim().length < 2) throw new NotFound("q needs two characters");
    return fields(params);
  }
  const one = /^\/catalogue\/tables\/(.+)$/.exec(path);
  if (one) return table(decodeURIComponent(one[1]), params);
  return NONE_CATALOGUE;
}

