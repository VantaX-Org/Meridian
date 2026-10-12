import apiClient from "../client";
import { downloadBlob } from "../download";
import type { ScoreBands } from "@/design/primitives/ScoreRing";
import type { Material360 } from "../materials";
import { optional } from "../optional";

export interface ObjectSummary {
  module: string;
  label: string;
  composite_score: number | null;
  readiness: "pass" | "warn" | "fail" | null;
  failing_checks: number;
  affected_records: number;
  /** Optional list-row enrichments; absent on older backends. */
  blocking_rule_id?: string | null;
  blocking_rule_name?: string | null;
  /** Composite score of the last <=8 runs of the same system, oldest first, including this run. */
  trend?: number[];
  worst_dimension?: string | null;
  owner?: string | null;
  /** Measured dimension scores for the run (unmeasured dimensions omitted). */
  dimension_scores?: Record<string, number>;
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
  (await optional(() => get<{ run_id: string | null; objects: ObjectSummary[]; blocking_findings_total?: number; thresholds?: ScoreBands }>("/api/v1/objects", { run })))
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
