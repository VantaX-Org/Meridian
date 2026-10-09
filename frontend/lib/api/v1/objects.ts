import apiClient from "../client";
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

/** A tenant with no completed run answers 404 for run=latest; that is an
 *  empty list, not an error, so every caller shows its empty state. */
export const getObjects = async (run: string) =>
  (await optional(() => get<{ run_id: string; objects: ObjectSummary[] }>("/api/v1/objects", { run })))
  ?? { run_id: "", objects: [] };

export const getObject = (module: string, run: string) =>
  get<ObjectDetail>(`/api/v1/objects/${encodeURIComponent(module)}`, { run });

export const getObjectRecord = (
  object: string,
  key: string,
  params: { version_id?: string; plant?: string } = {},
) =>
  get<Material360>(`/api/v1/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}`, params);
