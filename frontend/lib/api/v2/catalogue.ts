/**
 * Data catalogue client (api/routes/catalogue.py, view permission).
 *
 *   GET /catalogue/tables?q=&system=&limit=&offset=   tables of the SAP dictionary and of the tenant's live DDIC
 *   GET /catalogue/tables/{table}?system=             one table: every field with its facts
 *   GET /catalogue/fields?q=&system=&limit=           fields by name, TABLE.FIELD, description or business term
 *
 * Descriptions and types come from the SAP dictionary (a system's own DDIC when one is named), the rules from the
 * shipped YAML, the profile from the newest analysed run, the lineage from the lineage model. Nothing is estimated.
 */
import { v2Get } from "./client";

export interface CatalogueSystem {
  id: string;
  name: string;
  system_type: string;
  is_active: boolean;
}

export interface CatalogueTableRow {
  table: string;
  description: string;
  source: string;
  category?: string | null;
  field_count: number;
  customer_table?: boolean;
  objects: string[];
  rule_count: number;
  systems: string[];
}

export interface CatalogueTables {
  total: number;
  limit: number;
  offset: number;
  systems: CatalogueSystem[];
  tables: CatalogueTableRow[];
}

export interface CatalogueRule {
  check_id: string;
  module: string;
  severity: string;
  dimension?: string | null;
  check_class?: string | null;
  enabled: boolean;
  message: string;
  last_pass_rate?: number | null;
}

export interface CatalogueTerm {
  id: string;
  business_name: string;
  status: string;
  steward_name?: string | null;
}

/** The field statistics the profile route keeps (api/routes/field_profiles.py FieldStats); the catalogue shows these. */
export interface CatalogueStats {
  rows: number;
  table_rows: number;
  sampled?: boolean;
  blank: number;
  blank_pct: number;
  distinct: number;
  min_length?: number | null;
  max_length?: number | null;
  masked?: boolean;
  top_values?: { value: string; count: number }[] | null;
}

export interface CatalogueProfile {
  version_id: string;
  system_id?: string | null;
  module: string;
  run_at?: string | null;
  stats: CatalogueStats;
}

export interface CatalogueNode {
  id: string;
  type: string;
  label: string;
  hops: number;
}

export interface CatalogueValue {
  low: string;
  high?: string | null;
  text: string;
}

export interface CatalogueField {
  field: string;
  description: string;
  type?: string | null;
  length: number;
  decimals: number;
  key: boolean;
  data_element?: string | null;
  domain?: string | null;
  check_table?: string | null;
  check_field?: string | null;
  source?: string | null;
  provenance: string;
  fixed_values: CatalogueValue[];
  help?: string | null;
  mandatory?: boolean | null;
  processes: string[];
  tcodes: string[];
  rules: CatalogueRule[];
  terms: CatalogueTerm[];
  profile?: CatalogueProfile | null;
  lineage_node?: string | null;
  downstream: CatalogueNode[];
}

export interface CatalogueOwner {
  kind: string;
  ref: string;
  owner_name?: string | null;
  steward_name?: string | null;
}

export interface CatalogueTable {
  table: string;
  description: string;
  source: string;
  category?: string | null;
  delivery_class?: string | null;
  keys: string[];
  note?: string | null;
  obsolete_in?: string | null;
  system?: string | null;
  systems: CatalogueSystem[];
  objects: string[];
  owners: CatalogueOwner[];
  fields: CatalogueField[];
}

export interface CatalogueFieldHit {
  table: string;
  field: string;
  table_description: string;
  description: string;
  type?: string | null;
  length: number;
  key: boolean;
  rule_count: number;
  terms: CatalogueTerm[];
}

export interface CatalogueFields {
  total: number;
  limit: number;
  fields: CatalogueFieldHit[];
}

/** How many tables one page of the list holds. */
export const CATALOGUE_PAGE = 200;

export const getCatalogueTables = (q: { q?: string; system?: string; limit?: number; offset?: number }): Promise<CatalogueTables> =>
  v2Get<CatalogueTables>("/catalogue/tables", { q: q.q, system: q.system, limit: q.limit ?? CATALOGUE_PAGE, offset: q.offset });

export const getCatalogueTable = (table: string, system?: string): Promise<CatalogueTable> =>
  v2Get<CatalogueTable>(`/catalogue/tables/${encodeURIComponent(table)}`, { system });

export const searchCatalogueFields = (q: string, system?: string): Promise<CatalogueFields> =>
  v2Get<CatalogueFields>("/catalogue/fields", { q, system, limit: 100 });

/** `MARA.MATNR` as the inspector id, and back. A table name may hold slashes (`/SCWM/AQUA`), a field never a dot. */
export const fieldId = (table: string, field: string): string => `${table}.${field}`;
export function splitFieldId(id: string): { table: string; field: string } | null {
  const at = id.lastIndexOf(".");
  return at > 0 && at < id.length - 1 ? { table: id.slice(0, at), field: id.slice(at + 1) } : null;
}
