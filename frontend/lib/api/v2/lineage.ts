/**
 * Lineage clients: the field-to-KPI graph of one rule and its blast radius in documents.
 *
 * Endpoints (api/routes/lineage.py):
 *   GET /lineage/graph?node=check:{id}&direction=both&depth=8
 *   GET /lineage/blast-radius/{version_id}/{check_id}
 */
import { v2Get } from "./client";

export type LineageNodeType = "check" | "field" | "table" | "object" | "config" | "step" | "process" | "feature" | "kpi";

export interface LineageGraphNode {
  id: string;
  type: LineageNodeType;
  label: string;
  /** Hops from the start node: upstream negative, downstream positive. */
  depth: number;
  description?: string;
  table?: string;
  tcode?: string;
  l1?: string;
  l2?: string;
  system?: string;
  severity?: string;
}

export interface LineageGraph {
  start: string;
  model_version: string;
  nodes: LineageGraphNode[];
  edges: { source: string; target: string; rel: string }[];
  paths_to_kpis: string[][];
}

export interface BlastTarget {
  table: string;
  label: string;
  step: string | null;
  status: "ok" | "not_joinable" | "not_extracted";
  source_version_id: string | null;
  same_version: boolean | null;
  rows: number;
  documents: number;
  objects_touched: number;
  joined_on: string[];
}

export interface BlastRadius {
  version_id: string;
  check_id: string;
  grain: string | null;
  object: string | null;
  failing_records: number;
  keys_truncated: boolean;
  targets: BlastTarget[];
  steps_touched: string[];
  processes_touched: string[];
}

export const getRuleLineage = (checkId: string): Promise<LineageGraph> =>
  v2Get("/lineage/graph", { node: `check:${checkId}`, direction: "both", depth: 8 });

export const getBlastRadius = (versionId: string, checkId: string): Promise<BlastRadius> =>
  v2Get(`/lineage/blast-radius/${encodeURIComponent(versionId)}/${encodeURIComponent(checkId)}`);

export interface LineageModel {
  model_version: number;
  node_counts: Record<string, number>;
  edge_count: number;
  kpis: { id: string; label: string }[];
  processes: { id: string; label: string }[];
  features: { id: string; label: string }[];
  warnings: string[];
}

export interface GuardStep {
  id: string;
  label: string;
  l2: string | null;
  tcode: string | null;
  fields: { field: string; checks: { check_id: string; pass_rate?: number | null; affected_count?: number | null; severity?: string | null }[] }[];
  guard_count: number;
  /** The lowest pass rate of the rules guarding the step, in percent; null when none has run. */
  min_pass_rate: number | null;
  unguarded_fields: string[];
}

export interface Guards {
  node: string;
  model_version: number;
  version_id: string | null;
  steps: GuardStep[];
  /** Step ids no rule guards. */
  coverage_gaps: string[];
}

/** GET /lineage/model: the KPIs, processes and features the lineage model knows. */
export const getLineageModel = (): Promise<LineageModel> => v2Get("/lineage/model");

/** GET /lineage/guards: the rules guarding each process step behind a KPI, process, feature or step. */
export const getGuards = (node: string): Promise<Guards> => v2Get("/lineage/guards", { node });
