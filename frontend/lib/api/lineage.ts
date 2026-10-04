import apiClient from "./client";

export type LineageNodeType =
  | "config"
  | "check"
  | "field"
  | "table"
  | "object"
  | "step"
  | "process"
  | "feature"
  | "kpi";

export type LineageDirection = "up" | "down" | "both";
export type Severity = "low" | "medium" | "high" | "critical";
export type ImpactType = "cosmetic" | "degraded" | "full_block";

export interface NodeRef {
  id: string;
  label: string;
}

export interface LineageNode {
  id: string;
  type: LineageNodeType;
  label: string;
  /** Negative = upstream hops, positive = downstream hops, 0 = start. */
  depth: number;
  definition?: string;
  tcode?: string;
}

export interface LineageEdge {
  source: string;
  target: string;
  rel: string;
  origin: string;
  impact_type?: ImpactType;
}

export interface LineageModelSummary {
  model_version: number;
  node_counts: Partial<Record<LineageNodeType, number>>;
  edge_count: number;
  kpis: NodeRef[];
  processes: NodeRef[];
  features: NodeRef[];
  warnings: string[];
}

export interface LineageGraph {
  start: string;
  model_version: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
  paths_to_kpis: string[][];
}

export interface ImpactRow {
  id: string;
  type: "kpi" | "process" | "feature";
  label: string;
  findings: number;
  check_ids: string[];
  /** Sum over findings: upper bound (a record can fail several checks). */
  records_affected: number;
  /** Largest single finding: lower bound. */
  max_records: number;
  worst_severity: Severity | null;
  worst_impact: ImpactType | null;
  min_hops: number;
  cost_at_risk?: number | null;
}

export interface LineageImpact {
  version_id: string;
  model_version: number;
  cost_available: boolean;
  kpis: ImpactRow[];
  processes: ImpactRow[];
  features: ImpactRow[];
  unmapped_checks: string[];
}

export interface BlastTarget {
  table: string;
  label: string;
  step: string | null;
  status: "ok" | "not_joinable" | "not_extracted";
  source_version_id?: string | null;
  same_version?: boolean | null;
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

export interface GuardCheck {
  check_id: string;
  pass_rate?: number | null;
  affected_count?: number;
  severity?: Severity;
}

export interface GuardStep {
  id: string;
  label: string;
  l2: string | null;
  tcode: string | null;
  fields: { field: string; checks: GuardCheck[] }[];
  guard_count: number;
  min_pass_rate: number | null;
  unguarded_fields: string[];
}

export interface LineageGuards {
  node: string;
  model_version: number;
  version_id: string | null;
  steps: GuardStep[];
  coverage_gaps: string[];
}

export async function getLineageModel(): Promise<LineageModelSummary> {
  const { data } = await apiClient.get<LineageModelSummary>("/api/v1/lineage/model");
  return data;
}

export async function getLineage(params: {
  node: string;
  direction?: LineageDirection;
  depth?: number;
}): Promise<LineageGraph> {
  const { data } = await apiClient.get<LineageGraph>("/api/v1/lineage/graph", { params });
  return data;
}

export async function getLineageImpact(versionId: string): Promise<LineageImpact> {
  const { data } = await apiClient.get<LineageImpact>(`/api/v1/lineage/impact/${versionId}`);
  return data;
}

export async function getBlastRadius(versionId: string, checkId: string): Promise<BlastRadius> {
  const { data } = await apiClient.get<BlastRadius>(
    `/api/v1/lineage/blast-radius/${versionId}/${encodeURIComponent(checkId)}`,
  );
  return data;
}

export async function getLineageGuards(params: {
  node: string;
  version_id?: string;
}): Promise<LineageGuards> {
  const { data } = await apiClient.get<LineageGuards>("/api/v1/lineage/guards", { params });
  return data;
}
