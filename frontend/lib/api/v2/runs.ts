/**
 * Step 3 clients: runs, the run timeline, compare, jobs and systems. Reads go through v2Get, so fixture mode
 * (`?fixture=1`) answers them from lib/api/v2/fixtures/runs.ts; writes call the existing endpoints, and in fixture mode
 * resolve with the answer the endpoint gives, without a network call.
 *
 * Endpoints read, all existing: GET /runs/timeline, GET /runs/{a}/vs/{b}/summary, GET /versions, GET /versions/{id},
 * GET /versions/compare, POST /versions/{id}/baseline, POST /versions/archive, POST /versions/restore,
 * POST /versions/{id}/analyse, GET /jobs, GET /jobs/{id}, POST /jobs/{id}/retry, GET /systems, POST /systems/{id}/test,
 * GET and POST /connectivity/config-load, GET /systems/{id}/objects, /versions, /profiles, POST /systems/{id}/downloads.
 */
import apiClient from "@/lib/api/client";
import { downloadAuthenticated } from "@/lib/api/download";
import { getReportDownloadUrl } from "@/lib/api/reports";
import { startConfigLoad as liveStartConfigLoad, type ConfigLoad } from "@/lib/api/config-load";
import { retryJob as liveRetryJob } from "@/lib/api/jobs";
import { uploadFile as liveUploadFile } from "@/lib/api/upload";
import { startDownload as liveStartDownload, type DownloadScope, type SystemObject, type SystemVersion, type DownloadProgress } from "@/lib/api/system-objects";
import type { Job } from "@/types/jobs";
import type { SAPSystemExtended, SyncProfile, TestConnectionResponse } from "@/types/api";
import { fixtureActive } from "./fixture";
import { v2Get } from "./client";
import { fixtureAction } from "./fixtures/runs";
import { baselineGateFixture } from "./fixtures/step9";

// ── Runs ────────────────────────────────────────────────────────────────────

export interface TimelineObject {
  /** The composite score after the critical cap. */
  score: number | null;
  /** The measured score before the cap. */
  raw_score: number | null;
  capped: boolean;
}

export interface TimelineRun {
  id: string;
  run_at: string | null;
  label: string | null;
  system_id: string | null;
  baseline: boolean;
  /** scheduled | manual | recheck | upload; null for a run from before it was stamped. */
  kind: string | null;
  objects: Record<string, TimelineObject>;
  records_checked: number | null;
  duration_s: number | null;
}

/** GET /runs/timeline: the last N finished runs of the scope, OLDEST first. */
export interface Timeline {
  system_id: string | null;
  limit: number;
  runs: TimelineRun[];
}

export interface CompareSide {
  score: number | null;
  raw_score: number | null;
  capped: boolean;
  records_checked: number | null;
  coverage: number | null;
}

export interface CompareObject {
  module: string;
  label: string;
  before: CompareSide | null;
  after: CompareSide | null;
  score_change: number | null;
  newly_failing: number;
  fixed: number;
  worse: number;
  better: number;
}

export interface CompareRunRef {
  id: string;
  run_at: string | null;
  label: string | null;
}

export interface CompareTotals {
  records_checked_before: number | null;
  records_checked_after: number | null;
  newly_failing: number;
  fixed: number;
  worse: number;
  better: number;
  rules_compared: number;
  rules_added: number;
  rules_dropped: number;
}

/** GET /runs/{a}/vs/{b}/summary: b (after) against a (before). */
export interface CompareSummary {
  a: CompareRunRef;
  b: CompareRunRef;
  objects: CompareObject[];
  totals: CompareTotals;
  method: string;
}

export type ChangeKind = "newly_failing" | "fixed" | "worse" | "better";

export interface CheckChange {
  check_id: string;
  module: string;
  severity: string;
  message: string | null;
  v1_affected: number;
  v2_affected: number;
}

/** A run as GET /versions and GET /versions/{id} return it. */
export interface VersionHead {
  id: string;
  run_at: string;
  label: string | null;
  run_number?: number | null;
  parent_version_id?: string | null;
  status: string;
  dqs_summary: Record<string, { total_checks?: number; composite_score?: number | null; raw_score?: number | null; capped?: boolean }> | null;
  metadata: { system_id?: string; trigger?: string; baseline?: boolean; archived?: boolean; modules?: string[] } | null;
  severity_counts?: Record<string, number> | null;
}

export interface VersionPage {
  versions: VersionHead[];
  total: number;
}

/** GET /versions/compare: v2 (after) against v1 (before), the checks that moved. */
export interface VersionCompare {
  v1: VersionHead;
  v2: VersionHead;
  delta: Record<string, unknown>;
  checks: Record<ChangeKind, CheckChange[]>;
}

export function getTimeline(systemId: string | null, limit = 8): Promise<Timeline> {
  return v2Get<Timeline>("/runs/timeline", { system_id: systemId ?? undefined, limit });
}

export function getCompareSummary(a: string, b: string): Promise<CompareSummary> {
  return v2Get<CompareSummary>(`/runs/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}/summary`);
}

export function getVersionCompare(v1: string, v2: string): Promise<VersionCompare> {
  return v2Get<VersionCompare>("/versions/compare", { v1, v2 });
}

export function getVersionHead(id: string): Promise<VersionHead> {
  return v2Get<VersionHead>(`/versions/${encodeURIComponent(id)}`);
}

export interface VersionsQuery {
  limit?: number;
  system_id?: string;
  include_archived?: boolean;
  status?: "failed";
}

export function getVersionsPage(q: VersionsQuery = {}): Promise<VersionPage> {
  return v2Get<VersionPage>("/versions", { limit: q.limit ?? 50, system_id: q.system_id, include_archived: q.include_archived || undefined, status: q.status });
}

/**
 * POST /versions/{id}/baseline: pin (or unpin) the run as its lineage's baseline. Needs analyse. A run that breaches
 * an enforced data contract is refused with 409 (`baselineRefusalOf` reads it) unless `force` comes with a reason,
 * which the server audits.
 */
export async function pinBaseline(id: string, pinned: boolean, force?: { reason: string }): Promise<{ version_id: string; baseline: boolean }> {
  const body = force ? { force: true, reason: force.reason } : null;
  if (fixtureActive()) {
    baselineGateFixture(id, pinned, body ?? undefined);
    return fixtureAction("pin", { id, pinned }) as { version_id: string; baseline: boolean };
  }
  const { data } = await apiClient.post<{ version_id: string; baseline: boolean }>(`/api/v1/versions/${id}/baseline`, body, { params: { pinned } });
  return data;
}

/** POST /versions/archive: hides finished runs but the newest `keepLatest`. Nothing is deleted. Needs analyse. */
export async function archiveRuns(keepLatest: number): Promise<{ archived: number }> {
  if (fixtureActive()) return fixtureAction("archive", { keepLatest }) as { archived: number };
  const { data } = await apiClient.post<{ archived: number }>("/api/v1/versions/archive", null, { params: { keep_latest: keepLatest } });
  return data;
}

/** POST /versions/restore: brings every archived run back. Needs analyse. */
export async function restoreRuns(): Promise<{ restored: number }> {
  if (fixtureActive()) return fixtureAction("restore", {}) as { restored: number };
  const { data } = await apiClient.post<{ restored: number }>("/api/v1/versions/restore");
  return data;
}

/** POST /versions/{id}/analyse: scores a stored extraction again (or the first time). Needs analyse. */
export async function analyseRun(versionId: string): Promise<{ version_id: string; job_id: string; status: string }> {
  if (fixtureActive()) return fixtureAction("analyse", { versionId }) as { version_id: string; job_id: string; status: string };
  const { data } = await apiClient.post<{ version_id: string; job_id: string; status: string }>(`/api/v1/versions/${versionId}/analyse`);
  return data;
}

/**
 * POST /upload: a file of one object (CSV, TSV, Excel, JSON or Parquet) becomes a new stored run, and its analysis
 * starts at once. Columns are matched by the tenant's field mappings (Admin, Field mappings). `systemId` attaches the
 * run to a connected system. Needs the upload permission. Fixture mode answers without a network call.
 */
export async function uploadDataFile(file: File, module: string, systemId: string | null, onProgress: (pct: number) => void = () => undefined): Promise<{ version_id: string; job_id: string; status: string }> {
  if (fixtureActive()) {
    onProgress(100);
    return { version_id: "v-upload", job_id: "j-upload", status: "queued" };
  }
  return liveUploadFile(file, module, null, onProgress, { systemId });
}

/** The run's report (GET /reports/{id}/download) saved through the browser. */
export async function downloadRunReport(versionId: string): Promise<void> {
  if (fixtureActive()) {
    fixtureAction("download", { versionId });
    return;
  }
  await downloadAuthenticated(getReportDownloadUrl(versionId), `meridian-run-${versionId.slice(0, 8)}.pdf`);
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export function getJobsList(limit = 100): Promise<Job[]> {
  if (fixtureActive()) return v2Get<{ jobs: Job[] }>("/jobs", { limit }).then((r) => r.jobs);
  return apiClient.get<{ jobs: Job[] }>("/api/v1/jobs", { params: { limit } }).then((r) => r.data.jobs);
}

export function getJobById(id: string): Promise<Job> {
  if (fixtureActive()) return v2Get<Job>(`/jobs/${encodeURIComponent(id)}`);
  return apiClient.get<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`).then((r) => r.data);
}

/** POST /jobs/{id}/retry: starts a failed job again through the endpoint that started it. */
export async function retryJobById(id: string): Promise<{ job_id?: string | null; status?: string }> {
  if (fixtureActive()) return fixtureAction("retry", { id }) as { job_id?: string | null; status?: string };
  return liveRetryJob(id);
}

// ── Systems ─────────────────────────────────────────────────────────────────

export function getSystemsExtended(): Promise<SAPSystemExtended[]> {
  if (fixtureActive()) return v2Get<SAPSystemExtended[]>("/systems");
  return apiClient.get<SAPSystemExtended[]>("/api/v1/systems").then((r) => r.data);
}

/** POST /systems/{id}/test: the real answer of the connection test, shown in the frame it was asked from. */
export async function testSystemConnection(id: string): Promise<TestConnectionResponse> {
  if (fixtureActive()) return fixtureAction("test", { id }) as unknown as TestConnectionResponse;
  const { data } = await apiClient.post<TestConnectionResponse>(`/api/v1/systems/${id}/test`);
  return data;
}

/** The latest configuration load of the system, or null when none has run. */
export async function getSystemConfigLoad(id: string): Promise<ConfigLoad | null> {
  if (fixtureActive()) {
    const r = await v2Get<ConfigLoad | { status: "never_loaded" }>(`/connectivity/config-load/${encodeURIComponent(id)}`);
    return r.status === "never_loaded" ? null : (r as ConfigLoad);
  }
  try {
    const { data } = await apiClient.get<ConfigLoad>(`/api/v1/connectivity/config-load/${id}`);
    return data.status === "never_loaded" ? null : data;
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null;
    throw e;
  }
}

export async function loadSystemConfig(id: string): Promise<{ job_id: string; load_id?: string; status: string }> {
  if (fixtureActive()) return fixtureAction("config-load", { id }) as { job_id: string; status: string };
  return liveStartConfigLoad(id);
}

export function getSystemObjectList(id: string): Promise<{ system_type: string; objects: SystemObject[] }> {
  if (fixtureActive()) return v2Get<{ system_type: string; objects: SystemObject[] }>(`/systems/${encodeURIComponent(id)}/objects`);
  return apiClient.get<{ system_type: string; objects: SystemObject[] }>(`/api/v1/systems/${id}/objects`).then((r) => r.data);
}

export function getSystemExtractions(id: string): Promise<{ versions: SystemVersion[]; download: DownloadProgress | null }> {
  if (fixtureActive()) return v2Get<{ versions: SystemVersion[]; download: DownloadProgress | null }>(`/systems/${encodeURIComponent(id)}/versions`);
  return apiClient.get<{ versions: SystemVersion[]; download: DownloadProgress | null }>(`/api/v1/systems/${id}/versions`).then((r) => r.data);
}

export function getSystemProfiles(id: string): Promise<SyncProfile[]> {
  if (fixtureActive()) return v2Get<SyncProfile[]>(`/systems/${encodeURIComponent(id)}/profiles`);
  return apiClient.get<SyncProfile[]>(`/api/v1/systems/${id}/profiles`).then((r) => r.data);
}

/** POST /systems/{id}/downloads: extracts the chosen objects into a new run, optionally analysing straight after. */
export async function extractObjects(id: string, objects: string[], analyse: boolean, scope: DownloadScope = {}, label?: string, delta = false): Promise<{ job_id: string; status: string }> {
  if (fixtureActive()) return fixtureAction("extract", { id, objects, analyse, scope, label, delta }) as { job_id: string; status: string };
  return liveStartDownload(id, { objects, scope, label, analyse, ...(delta ? { delta: true } : {}) });
}
