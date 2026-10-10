import apiClient from "../client";
import { downloadBlob } from "../download";
import type { Material360 } from "../materials";
import { optional } from "../optional";

export interface ObjectSummary {
  module: string;
  label: string;
  composite_score: number | null;
  readiness: "pass" | "warn" | "fail" | null;
  failing_checks: number;
  affected_records: number;
}

export interface ObjectRule {
  check_id: string;
  severity: string;
  dimension: string | null;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
}

export interface ObjectDetail extends ObjectSummary {
  dimension_scores: Record<string, number>;
  rules: ObjectRule[];
}

const get = async <T>(path: string, params?: Record<string, string | undefined>) =>
  (await apiClient.get<T>(path, { params })).data;

/** A tenant with no completed run answers 200 with `run_id: null` and an
 *  empty list for run=latest — that is an empty state, not an error. */
export const getObjects = async (run: string) =>
  (await optional(() => get<{ run_id: string | null; objects: ObjectSummary[] }>("/api/v1/objects", { run })))
  ?? { run_id: null, objects: [] };

export const getObject = (module: string, run: string) =>
  get<ObjectDetail>(`/api/v1/objects/${encodeURIComponent(module)}`, { run });

export const getObjectRecord = (
  object: string,
  key: string,
  params: { version_id?: string; plant?: string } = {},
) =>
  get<Material360>(`/api/v1/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}`, params);

/** GET /api/v1/objects/export — every object's summary row for the run, as CSV or XLSX. */
export function exportObjects(run: string, format: "csv" | "xlsx" = "xlsx"): Promise<void> {
  return downloadBlob("/api/v1/objects/export", { run, format }, `objects.${format}`);
}

/** GET /api/v1/objects/{module}/export — the rules table behind one object, as CSV or XLSX. */
export function exportObject(module: string, run: string, format: "csv" | "xlsx" = "xlsx"): Promise<void> {
  return downloadBlob(`/api/v1/objects/${encodeURIComponent(module)}/export`, { run, format }, `${module}.${format}`);
}
