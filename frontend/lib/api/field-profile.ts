import apiClient from "./client";
import { downloadBlob } from "./download";

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
  /** Already accepted as a check. */
  accepted: boolean;
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

/** GET /api/v1/versions/{versionId}/profile — same profile, keyed by version alone (no system_id needed, e.g. upload-sourced runs). */
export async function getProfileByVersion(versionId: string, object?: string): Promise<VersionProfile> {
  return (
    await apiClient.get(`/api/v1/versions/${versionId}/profile`, {
      params: { object },
    })
  ).data;
}

/** GET /api/v1/systems/{systemId}/versions/{versionId}/profile/export — one sheet per table plus Dependencies. */
export function exportVersionProfile(
  systemId: string,
  versionId: string,
  format: "csv" | "xlsx",
  object?: string,
): Promise<void> {
  return downloadBlob(
    `/api/v1/systems/${systemId}/versions/${versionId}/profile/export`,
    { format, object },
    `profile.${format}`,
  );
}

/** Accept a mined dependency as a check run on every later analysis of the object. */
export async function acceptDependency(body: {
  module: string;
  determinant: string;
  dependent: string;
}): Promise<{ id: string; name: string }> {
  return (await apiClient.post("/api/v1/rules/mined", body)).data;
}
