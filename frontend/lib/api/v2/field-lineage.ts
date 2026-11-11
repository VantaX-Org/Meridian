/**
 * Field lineage client (api/routes/lineage.py).
 *
 *   GET /lineage/fields?module=   table -> field -> check table -> owning object, with the rules that read each field
 *
 * Built from the SAP data dictionary, the extraction registry and the rule packs; a field the dictionary does not
 * know is listed with in_dictionary false, never guessed. The business term is the tenant's glossary term when one is
 * linked, else the DDIC field text.
 */
import { v2Get } from "./client";

export interface FieldLineageRow {
  field: string;
  in_dictionary: boolean;
  text: string;
  data_element?: string | null;
  domain?: string | null;
  type?: string | null;
  length?: number | null;
  key: boolean;
  check_table?: string | null;
  check_field?: string | null;
  check_table_text?: string | null;
  check_delivery_class?: string | null;
  owner?: string | null;
  fixed_values: number;
  glossary_terms: string[];
  rule_count: number;
  rule_ids: string[];
}

export interface FieldLineageTable { table: string; text: string; in_dictionary: boolean; fields: FieldLineageRow[] }

export interface FieldLineageTotals {
  tables: number;
  fields: number;
  foreign_keys: number;
  fields_with_rules: number;
  not_in_dictionary: number;
  cross_object: number;
}

export interface FieldLineage {
  module: string;
  system_type: string;
  release: string;
  tables: FieldLineageTable[];
  totals: FieldLineageTotals;
}

export const getFieldLineage = (module: string, system_type?: string) =>
  v2Get<FieldLineage>("/lineage/fields", { module, system_type });
