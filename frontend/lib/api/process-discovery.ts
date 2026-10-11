/**
 * Typed client for /api/v1/process-discovery (process-discovery spec §5.3,
 * api/routes/process_discovery.py). Shapes mirror the route's JSON exactly.
 */
import apiClient from "./client";
import { downloadBlob } from "./download";
import type { ProcessModelDocument } from "@/types/process-model";

const BASE = "/api/v1/process-discovery";

/** process_discovery_runs CHECK constraints (migration 079). */
export type Coverage = "discovered" | "partial" | "reference";
export type RunStatus = "queued" | "waiting" | "extracting" | "building" | "mining" | "completed" | "failed";
export const ACTIVE_RUN: ReadonlySet<RunStatus> = new Set(["queued", "waiting", "extracting", "building", "mining"]);
export type RunMode = "full" | "incremental";

export interface RunRef {
  id: string;
  status: RunStatus;
  job_id: string | null;
  error: string | null;
}

/** `last_run` is the latest completed run; `in_progress` and `failed` are newer runs beside it. */
export interface CatalogueRow {
  l1: string;
  name: string;
  coverage: Coverage;
  /** Why the L1 has no source on this system type (spec §10); null when it has one. */
  reason: string | null;
  last_run: {
    id: string;
    status: RunStatus;
    job_id: string | null;
    finished_at: string | null;
    error: string | null;
    cases: number | null;
    variants: number | null;
    median_seconds: number | null;
    automation_rate: number | null;
    fitness: number | null;
  } | null;
  /** A run newer than `last_run` that is still going: the card shows its live stage over the last result. */
  in_progress: RunRef | null;
  /** The newest run, when it failed after `last_run`. */
  failed: RunRef | null;
  sources: { table: string; rows: number; partial: boolean }[];
}

export interface RunStats {
  cases?: number;
  events?: number;
  variants?: number;
  case_types?: Record<string, number>;
  throughput?: { median_seconds: number | null; p90_seconds: number | null };
  automation_rate?: number | null;
  conformance?: { fitness: number | null; missing: Record<string, number>; out_of_order: Record<string, number> };
  rework?: Record<string, number>;
  tables?: Record<string, { rows: number; partial: boolean }>;
  truncated_tables?: string[];
  shared_objects?: number;
  unmapped?: Record<string, number>;
  /** Reference-only runs: the §10 reason. */
  reason?: string;
}

export interface DiscoveryRun {
  id: string;
  l1: string;
  mode: RunMode;
  status: RunStatus;
  coverage: Coverage | null;
  window_from: string | null;
  window_to: string | null;
  watermark: string | null;
  extraction_version_id: string | null;
  job_id: string | null;
  filters: Record<string, unknown>;
  stats: RunStats;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** GET /runs/{id} adds the system the run belongs to. */
export interface DiscoveryRunDetail extends DiscoveryRun {
  system_id: string;
  system_type: string;
}

export interface StartRunsBody {
  l1s: string[];
  mode: RunMode;
  period_from?: string | null;
}

/** URL filters the mined views accept (api/services/process_discovery/filters.py `ProcessFilter.from_query`). */
export type ProcessFilterParams = Record<string, string | number | boolean | undefined>;

export interface NodeStats {
  id: string;
  name: string;
  source: string;
  observed: boolean;
  case_count: number;
  share: number;
  median_seconds: number | null;
  fitness: number | null;
}

export interface Dfg {
  level: number;
  node: NodeStats;
  nodes: NodeStats[];
  /** START and END are pseudo-nodes; `median_seconds` is the median wait on the edge (null from START). */
  edges: { source: string; target: string; count: number; median_seconds: number | null }[];
  edge_threshold: number;
  cached: boolean;
}

export interface VariantRow {
  hash: string;
  activities: string[];
  case_count: number;
  share: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  fitness: number | null;
  sample_case_ids: string[];
}

export interface Conformance {
  case_type: string;
  fitness: number | null;
  missing: Record<string, number>;
  steps: { activity: string; step_fitness: number | null; out_of_order: number }[];
}

export interface CaseRow {
  case_id: string;
  first_ts: string;
  last_ts: string;
  events: number;
  variant: string;
}

export interface CaseEvent {
  activity: string;
  l5_id: string | null;
  ts: string;
  ts_precision: string;
  seq: number;
  resource: string | null;
  automated: boolean | null;
  doc_type: string | null;
  org: Record<string, string> | null;
  object_refs: Record<string, string> | null;
  attributes: Record<string, unknown> | null;
  source_table: string;
}

export interface Page<T> { case_type: string; total: number; items: T[] }

export async function getCatalogue(systemId: string): Promise<CatalogueRow[]> {
  return (await apiClient.get<CatalogueRow[]>(`${BASE}/systems/${systemId}/catalogue`)).data;
}
export async function startRuns(systemId: string, body: StartRunsBody): Promise<{ job_id: string | null; run_ids: string[] }> {
  return (await apiClient.post(`${BASE}/systems/${systemId}/runs`, body)).data;
}
export async function listRuns(systemId: string, params: { l1?: string; limit?: number } = {}): Promise<DiscoveryRun[]> {
  return (await apiClient.get<DiscoveryRun[]>(`${BASE}/systems/${systemId}/runs`, { params })).data;
}
export async function getRun(runId: string): Promise<DiscoveryRunDetail> {
  return (await apiClient.get<DiscoveryRunDetail>(`${BASE}/runs/${runId}`)).data;
}
export async function getRunModel(runId: string): Promise<ProcessModelDocument> {
  return (await apiClient.get<ProcessModelDocument>(`${BASE}/runs/${runId}/model`)).data;
}
export async function getDfg(runId: string, params: ProcessFilterParams & { node_id?: string; all_edges?: boolean }): Promise<Dfg> {
  return (await apiClient.get<Dfg>(`${BASE}/runs/${runId}/dfg`, { params })).data;
}
export async function getVariants(runId: string, params: ProcessFilterParams & { limit?: number; offset?: number }): Promise<Page<VariantRow>> {
  return (await apiClient.get<Page<VariantRow>>(`${BASE}/runs/${runId}/variants`, { params })).data;
}
export async function getConformance(runId: string, params: ProcessFilterParams): Promise<Conformance> {
  return (await apiClient.get<Conformance>(`${BASE}/runs/${runId}/conformance`, { params })).data;
}
export async function listCases(
  runId: string, params: ProcessFilterParams & { activity?: string; variant?: string; limit?: number; offset?: number },
): Promise<Page<CaseRow>> {
  return (await apiClient.get<Page<CaseRow>>(`${BASE}/runs/${runId}/cases`, { params })).data;
}
export async function getCaseEvents(runId: string, caseId: string, params: ProcessFilterParams): Promise<{ case_type: string; case_id: string; events: CaseEvent[] }> {
  // PTP case ids are "EBELN/EBELP": the route takes the id as a path tail, so the slash stays unescaped.
  const tail = caseId.split("/").map(encodeURIComponent).join("/");
  return (await apiClient.get(`${BASE}/runs/${runId}/cases/${tail}`, { params })).data;
}
/** Whole-L1 Signavio package (.zip), or one node's .bpmn when `nodeId` is given. Writes an audit row server-side. */
export function exportRun(runId: string, l1: string, params: ProcessFilterParams, nodeId?: string): Promise<void> {
  return nodeId
    ? downloadBlob(`${BASE}/runs/${runId}/export/bpmn/${encodeURIComponent(nodeId)}`, params, `${nodeId}.bpmn`)
    : downloadBlob(`${BASE}/runs/${runId}/export/signavio`, params, `meridian-asis-${l1}.zip`);
}
