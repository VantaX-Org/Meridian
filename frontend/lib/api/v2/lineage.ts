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
