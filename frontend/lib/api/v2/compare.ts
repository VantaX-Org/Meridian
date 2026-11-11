/**
 * Source and target system comparison (api/routes/system_compare.py): pairs of connected systems per object, record
 * reconciliation with field differences that know SAP transformations, config comparison and the three scores.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import type { ReconReason } from "./migration";

export type CompareKind = "missing" | "extra" | "differing";
export type CompareStatus = "queued" | "running" | "done" | "failed";
export interface SystemRef { id: string; name: string; type?: string }
export type KeyMap = Record<string, { source: string[]; target: string[] }>;

export interface CompareScores {
  module: string;
  source: number | null;
  projected: number | null;
  actual: number | null;
  actual_reason?: string | null;
  projected_reason?: string | null;
  migration_run_id?: string | null;
  reasons: ReconReason[];
}

export interface CompareSummary {
  tables: number; comparable: number; in_source: number; in_target: number; matched: number;
  missing_in_target: number; extra_in_target: number; key_mapped: number; differing_fields: number; transformed_fields: number;
}

export interface ComparePair {
  id: string;
  module: string;
  key_map: KeyMap;
  source: SystemRef;
  target: SystemRef;
  created_at: string;
  updated_at: string;
  last: { id: string; status: CompareStatus; at: string | null; summary: CompareSummary | null; scores: CompareScores | null } | null;
}

export interface PairList {
  pairs: ComparePair[];
  suggestions: { source: SystemRef; target: SystemRef }[];
  systems: SystemRef[];
  modules: string[];
}

export interface FieldCompare {
  field: string; description: string; compared: number; equal: number;
  transformed: Record<string, number>; differing: number; withheld: boolean;
}

export interface TableCompare {
  table: string; description: string; comparable: boolean; reason: string | null;
  source_keys: string[]; target_keys: string[]; key_mapped: number;
  in_source: number; in_target: number; matched: number; missing_in_target: number; extra_in_target: number;
  duplicate_source: number; duplicate_target: number; fields: FieldCompare[];
  records_total: Record<CompareKind, number>; capped: boolean; absent_keys?: string[];
}

export interface ConfigObject {
  object: string; exists: number; key_match: number; desc_match: number; missing: number;
  in_source: number; in_target: number; only_in_target: number;
}

export interface Comparison {
  id: string;
  pair_id: string;
  status: CompareStatus;
  progress: { stage: string; done: number; total: number; table?: string } | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  summary: CompareSummary | null;
  tables: TableCompare[];
  config: { available: boolean; reason?: string; objects?: ConfigObject[]; only_in_source?: string[]; only_in_target?: string[] } | null;
  scores: CompareScores | null;
}

export interface DiffRow { table: string; table_text: string; kind: CompareKind; key: string; field: string | null; field_text: string; source: string | null; target: string | null }
export interface DiffPage { total: number; offset: number; rows: DiffRow[]; kinds: CompareKind[] }
export interface DiffQuery { table?: string; field?: string; kind?: CompareKind; q?: string; offset?: number; limit?: number }
export interface RecordPair {
  table: string; key: string; in_source: boolean; in_target: boolean;
  fields: { field: string; description: string; source: string | null; target: string | null; verdict: string }[];
}
export interface TrendPointRow { comparison_id: string; at: string; source: number | null; projected: number | null; actual: number | null; missing_in_target: number | null; differing_fields: number | null }

const P = "/compare";
export const getPairs = () => v2Get<PairList>(`${P}/pairs`);
export const createPair = (b: { module: string; source_system_id: string; target_system_id: string; key_map?: KeyMap }) => v2Send<ComparePair>("POST", `${P}/pairs`, b);
export const patchPair = (id: string, key_map: KeyMap) => v2Send<ComparePair>("PATCH", `${P}/pairs/${id}`, { key_map });
export const deletePair = (id: string) => v2Send<{ deleted: string }>("DELETE", `${P}/pairs/${id}`);
export const runPair = (id: string) => v2Send<{ comparison_id: string; task_id: string; status: CompareStatus }>("POST", `${P}/pairs/${id}/run`);
export const getLatest = (id: string) => v2Get<{ pair: ComparePair; comparison: Comparison | null }>(`${P}/pairs/${id}/latest`);
export const getTrend = (id: string) => v2Get<{ points: TrendPointRow[] }>(`${P}/pairs/${id}/trend`);
export const getDifferences = (cid: string, q: DiffQuery) => v2Get<DiffPage>(`${P}/comparisons/${cid}/differences`, { ...q });
export const getRecordPair = (cid: string, table: string, key: string) => v2Get<RecordPair>(`${P}/comparisons/${cid}/pair`, { table, key });
export const exportComparison = (cid: string, format: "xlsx" | "csv", q: DiffQuery) =>
  v2Download(`${P}/comparisons/${cid}/export`, { format, table: q.table, field: q.field, kind: q.kind, q: q.q }, `system_compare_${cid}.${format}`);
