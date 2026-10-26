import apiClient from "./client";

/** The user guide as one PDF: every chapter of /docs, rendered by the API. */
export function getUserGuidePdfUrl(): string {
  return "/api/v1/docs/user-guide.pdf";
}

export function getReportDownloadUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/download`;
}

export function getReportJsonExportUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/export.json`;
}

/** The home page's executive summary PDF for the latest run. */
export function getExecutiveReportUrl(versionId: string): string {
  return `/api/v1/reports/executive/${versionId}.pdf`;
}

/* Deterministic run reports (PDF, rendered on request). */
export function getAnalysisReportUrl(versionId: string): string {
  return `/api/v1/reports/analysis/${versionId}.pdf`;
}

export function getExtractionReportUrl(versionId: string): string {
  return `/api/v1/reports/extraction/${versionId}.pdf`;
}

/** One object's rules and fields for one run, rendered on request. */
export function getObjectReportUrl(versionId: string, module: string): string {
  return `/api/v1/reports/object/${versionId}/${encodeURIComponent(module)}.pdf`;
}

/** One record's fix sheet for one run, rendered on request. */
export function getRecordReportUrl(versionId: string, matnr: string): string {
  return `/api/v1/reports/record/${versionId}/${encodeURIComponent(matnr)}.pdf`;
}

/** Without a version: cleaning and fixes across the whole organisation. */
export function getCleaningReportUrl(versionId?: string): string {
  return versionId ? `/api/v1/reports/cleaning.pdf?version_id=${versionId}` : "/api/v1/reports/cleaning.pdf";
}

/** v1 defaults to the pinned baseline, else the previous run of the same system. */
export function getComparisonReportUrl(v2: string, v1?: string): string {
  const q = new URLSearchParams({ v2, ...(v1 ? { v1 } : {}) });
  return `/api/v1/reports/compare.pdf?${q.toString()}`;
}

/** One entry of the report catalogue. `url` is null while a required input is missing or no run is chosen. */
export interface CatalogueEntry {
  id: string;
  name: string;
  format: "PDF" | "XLSX" | "JSON";
  about: string;
  sections: string[];
  page_estimate: number;
  requires: string[];
  url: string | null;
  last_built_at: string | null;
}

export async function getReportCatalogue(params: { version_id?: string; module?: string; compare?: string }): Promise<CatalogueEntry[]> {
  const { data } = await apiClient.get<CatalogueEntry[]>("/api/v1/reports/catalogue", { params });
  return data;
}

/** The analyst workbook for one run, optionally for one module and against an earlier run. */
export function getWorkbookUrl(versionId: string, opts?: { module?: string; compare?: string }): string {
  const q = new URLSearchParams();
  if (opts?.module) q.set("module", opts.module);
  if (opts?.compare) q.set("compare", opts.compare);
  const qs = q.toString();
  return `/api/v1/reports/${versionId}/workbook.xlsx${qs ? `?${qs}` : ""}`;
}

/** The board pack. Deltas are against `compare` only. */
export function getBoardReportUrl(versionId: string, compare?: string): string {
  return `/api/v1/reports/board/${versionId}.pdf${compare ? `?compare=${compare}` : ""}`;
}

export async function pollVersionStatus(
  versionId: string,
  onUpdate: (status: string) => void,
  timeoutMs: number = 600_000
): Promise<string> {
  const start = Date.now();
  const TERMINAL = new Set([
    "complete",
    "agents_complete",
    "failed",
    "agents_failed",
    "ai_enriching",
    "ai_enriched",
  ]);

  while (Date.now() - start < timeoutMs) {
    const { data } = await apiClient.get<{ status: string }>(
      `/api/v1/versions/${versionId}/status`
    );
    onUpdate(data.status);
    if (TERMINAL.has(data.status)) {
      return data.status;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Polling timed out");
}

/* ── Report history: every report file Meridian generated (downloads and scheduled runs) ── */

export type ReportFileFormat = "pdf" | "xlsx" | "json";

export interface ReportFile {
  id: string;
  /** The catalogue id of the report (board, workbook, trend ...). */
  kind: string;
  name: string;
  version_id: string | null;
  run_label: string | null;
  run_at: string | null;
  format: ReportFileFormat;
  file_name: string;
  size_bytes: number;
  source: "download" | "schedule" | "run_now";
  schedule_id: string | null;
  created_by: string | null;
  created_by_label: string | null;
  created_at: string;
  /** The viewer made it, or is a reports admin. */
  can_delete: boolean;
}

export interface ReportFilePage {
  total: number;
  limit: number;
  offset: number;
  items: ReportFile[];
}

export async function getReportHistory(params: { kind?: string; limit?: number; offset?: number } = {}): Promise<ReportFilePage> {
  const { data } = await apiClient.get<ReportFilePage>("/api/v1/reports/history", { params });
  return data;
}

export function getReportHistoryDownloadUrl(fileId: string): string {
  return `/api/v1/reports/history/${encodeURIComponent(fileId)}/download`;
}

export async function deleteReportFile(fileId: string): Promise<void> {
  await apiClient.delete(`/api/v1/reports/history/${encodeURIComponent(fileId)}`);
}

/* ── Scheduled reports ── */

export type ScheduleCadence = "daily" | "weekly" | "monthly";
export type ScheduleRunStatus = "running" | "sent" | "partial" | "failed" | "skipped";

export interface ReportScheduleParams {
  /** "latest" (any finished run), "upload" (file uploads) or a system id. */
  scope: string;
  module?: string | null;
}

export interface ReportScheduleInput {
  name: string;
  kind: string;
  format?: ReportFileFormat;
  params: ReportScheduleParams;
  cadence: ScheduleCadence;
  /** "HH:MM" in the schedule's time zone. */
  time_of_day: string;
  /** 0 = Monday; weekly only. */
  weekday?: number | null;
  /** 1-31, clamped to the month's last day; monthly only. */
  day_of_month?: number | null;
  /** IANA name; omitted means the tenant's time zone. */
  timezone?: string | null;
  recipient_user_ids: string[];
  recipient_channel_ids: string[];
  enabled: boolean;
}

export interface ReportSchedule {
  id: string;
  name: string;
  kind: string;
  format: ReportFileFormat;
  params: ReportScheduleParams;
  cadence: ScheduleCadence;
  time_of_day: string;
  weekday: number | null;
  day_of_month: number | null;
  timezone: string;
  recipient_user_ids: string[];
  recipient_channel_ids: string[];
  enabled: boolean;
  last_run_at: string | null;
  last_status: ScheduleRunStatus | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
  /** "Every Monday at 07:00 (Africa/Johannesburg)". */
  summary: string;
  /** The viewer made it, or is a reports admin. */
  can_edit: boolean;
}

export interface ScheduleOption {
  id: string;
  label: string;
  detail?: string | null;
}

export interface ScheduleOptions {
  timezone: string;
  types: { id: string; name: string; format: ReportFileFormat; needs_run: boolean; needs_module: boolean }[];
  users: ScheduleOption[];
  /** Alert channels, labelled without their target URL. */
  channels: ScheduleOption[];
  systems: ScheduleOption[];
  modules: string[];
}

export async function getReportSchedules(): Promise<ReportSchedule[]> {
  const { data } = await apiClient.get<ReportSchedule[]>("/api/v1/reports/schedules");
  return data;
}

export async function getReportScheduleOptions(): Promise<ScheduleOptions> {
  const { data } = await apiClient.get<ScheduleOptions>("/api/v1/reports/schedules/options");
  return data;
}

export async function createReportSchedule(body: ReportScheduleInput): Promise<ReportSchedule> {
  const { data } = await apiClient.post<ReportSchedule>("/api/v1/reports/schedules", body);
  return data;
}

export async function updateReportSchedule(id: string, body: ReportScheduleInput): Promise<ReportSchedule> {
  const { data } = await apiClient.put<ReportSchedule>(`/api/v1/reports/schedules/${encodeURIComponent(id)}`, body);
  return data;
}

export async function deleteReportSchedule(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/reports/schedules/${encodeURIComponent(id)}`);
}

/** Generate and deliver now, on the worker; the next scheduled run is unchanged. */
export async function runReportScheduleNow(id: string): Promise<{ queued: boolean; due_at: string }> {
  const { data } = await apiClient.post<{ queued: boolean; due_at: string }>(`/api/v1/reports/schedules/${encodeURIComponent(id)}/run`);
  return data;
}
