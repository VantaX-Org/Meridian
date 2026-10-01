import apiClient from "./client";

/** Why a field carries no top values: personal data, or not a short code field. */
export type MaskReason = "privacy" | "not_code_like";

export interface ShapeCount {
  /** Letters → A, digits → 9, everything else kept; at most 20 characters. */
  shape: string;
  count: number;
  /** Share of populated values, 0–1. */
  share: number;
}

export interface ValueCount {
  value: string;
  count: number;
}

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
  shapes: ShapeCount[];
  shape_count: number;
  masked: boolean;
  mask_reason: MaskReason | null;
  /** Only for non-sensitive code fields (≤ 50 values, DDIC length ≤ 10). */
  top_values: ValueCount[] | null;
}

export interface FieldProfile {
  field: string;
  stats: FieldStats;
}

export interface TableProfile {
  table: string;
  rows: number;
  table_rows: number;
  sampled: boolean;
  fields: FieldProfile[];
}

/** Candidate hidden rule: `determinant` decides `dependent` for `support` of the records. */
export interface FieldDependency {
  table: string;
  determinant: string;
  dependent: string;
  support: number;
  rows: number;
  violations: number;
  sample_keys: string[];
}

export interface VersionProfile {
  version_id: string;
  object: string | null;
  /** Objects of this version that carry a profile. */
  objects: string[];
  tables: TableProfile[];
  dependencies: FieldDependency[];
}

export async function getVersionProfile(
  systemId: string,
  versionId: string,
  object?: string
): Promise<VersionProfile> {
  return (
    await apiClient.get(`/api/v1/systems/${systemId}/versions/${versionId}/profile`, {
      params: { object },
    })
  ).data;
}
