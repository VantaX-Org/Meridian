/**
 * The field profile of a run (api/routes/field_profiles.py): GET /versions/{id}/profile?object= gives per-field
 * statistics of every table the object reads and the dependencies mined between its fields. POST /rules/mined
 * (api/routes/rules.py, manage_rules) turns a mined dependency into a rule every later run checks.
 */
import { v2Get, v2Send } from "./client";

export interface FieldStats {
  rows: number;
  table_rows: number;
  sampled: boolean;
  blank: number;
  blank_pct: number;
  distinct: number;
  min_length: number | null;
  max_length: number | null;
  ddic_type: string | null;
  ddic_length: number | null;
  description: string | null;
  numeric: { min: number | null; max: number | null; mean: number | null; non_numeric: number } | null;
  dates: { min: string | null; max: string | null; invalid: number } | null;
  shapes: { shape: string; count: number; share: number }[];
  shape_count: number;
  /** True when values are withheld: privacy, or a free-text field where a value list says nothing. */
  masked: boolean;
  mask_reason: "privacy" | "not_code_like" | null;
  top_values: { value: string; count: number }[] | null;
}

export interface TableProfile {
  table: string;
  rows: number;
  table_rows: number;
  sampled: boolean;
  fields: { field: string; stats: FieldStats }[];
}

export interface Dependency {
  table: string;
  /** Qualified, TABLE.FIELD. */
  determinant: string;
  dependent: string;
  /** Share of populated rows that follow the dependency, 0 to 1. */
  support: number;
  rows: number;
  violations: number;
  sample_keys: string[];
  /** Already a rule. */
  accepted: boolean;
}

export interface Profile {
  version_id: string;
  object: string | null;
  objects: string[];
  tables: TableProfile[];
  dependencies: Dependency[];
}

export type Severity = "critical" | "high" | "medium" | "low";

export const getProfile = (versionId: string, object: string): Promise<Profile> => v2Get(`/versions/${encodeURIComponent(versionId)}/profile`, { object });
export const acceptMinedRule = (body: { module: string; determinant: string; dependent: string; severity: Severity }): Promise<{ id: string; name: string; module: string; severity: Severity; enabled: boolean }> =>
  v2Send("POST", "/rules/mined", body);
