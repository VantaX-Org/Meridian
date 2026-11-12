/**
 * Reports and their schedules, and the migration waves, on the endpoints the current interface uses
 * (api/routes/report_library.py, api/routes/reports.py, api/routes/migration.py).
 */
import type { CatalogueEntry, ReportFilePage, ReportSchedule, ReportScheduleInput, ScheduleOptions } from "@/lib/api/reports";
import type { MigrationWave, WaveCockpit, WaveStage } from "@/types/api";
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

const enc = encodeURIComponent;

export type { CatalogueEntry, ReportFilePage, ReportSchedule, ReportScheduleInput, ScheduleOptions, MigrationWave };

/** GET /reports/catalogue: every report kind with the address that builds it for the run and object chosen. */
export const getCatalogue = (q: { version_id?: string; module?: string; compare?: string } = {}): Promise<CatalogueEntry[]> => v2Get("/reports/catalogue", q);
export const getReportHistory = (q: { kind?: string; limit?: number; offset?: number } = {}): Promise<ReportFilePage> => v2Get("/reports/history", q);
export const deleteReportFile = (id: string): Promise<void> => v2Send("DELETE", `/reports/history/${enc(id)}`);
export const downloadReportFile = (id: string, name: string): Promise<string> => v2Download(`/reports/history/${enc(id)}/download`, undefined, name);

/** Builds a report from its catalogue address (`/api/v1/...`) and saves it; the API records it in the history. */
export function buildReport(entry: CatalogueEntry): Promise<string> {
  if (!entry.url) throw new Error("This report needs a run before it can be built.");
  const [path, query] = entry.url.replace(/^\/api\/v1/, "").split("?");
  const params = Object.fromEntries(new URLSearchParams(query ?? "").entries());
  const ext = entry.format.toLowerCase();
  return v2Download(path, params, `${entry.id}.${ext}`);
}

export const getSchedules = (): Promise<ReportSchedule[]> => v2Get("/reports/schedules");
export const getScheduleOptions = (): Promise<ScheduleOptions> => v2Get("/reports/schedules/options");
export const createSchedule = (body: ReportScheduleInput): Promise<ReportSchedule> => v2Send("POST", "/reports/schedules", body);
export const updateSchedule = (id: string, body: ReportScheduleInput): Promise<ReportSchedule> => v2Send("PUT", `/reports/schedules/${enc(id)}`, body);
export const deleteSchedule = (id: string): Promise<void> => v2Send("DELETE", `/reports/schedules/${enc(id)}`);
export const runScheduleNow = (id: string): Promise<{ queued: boolean; due_at: string }> => v2Send("POST", `/reports/schedules/${enc(id)}/run`);

/* ── Export centre (api/services/export_centre.py) ── */

export type ExportFormat = "xlsx" | "csv" | "json" | "pdf";
export type ExportSplit = "none" | "module" | "severity" | "run";
export type ExportSeverity = "critical" | "high" | "medium" | "low";
export type ExportRun = "latest" | "all";
export interface ExportDataset {
  id: string;
  name: string;
  /** Which of system, module, run and severity narrow this dataset. */
  filters: string[];
  /** A PDF exists (it delegates to the matching report). */
  pdf: boolean;
  columns: { key: string; header: string }[];
}
export interface ExportOptions {
  datasets: ExportDataset[];
  formats: ExportFormat[];
  splits: ExportSplit[];
  severities: ExportSeverity[];
}
export interface ExportRequest {
  dataset: string;
  format: ExportFormat;
  columns: string[];
  system: string | null;
  module: string | null;
  run: ExportRun;
  severity: ExportSeverity[];
  split: ExportSplit;
}

/** GET /reports/exports/options: the datasets the export centre writes, their columns and filters. */
export const getExportOptions = (): Promise<ExportOptions> => v2Get("/reports/exports/options");
/** POST /reports/exports: queues one export (needs export). Progress arrives on the jobs stream as kind export. */
export const startExport = (body: ExportRequest): Promise<{ job_id: string }> => v2Send("POST", "/reports/exports", body);

/* ── Migration waves ── */

export interface WavePatch {
  name?: string;
  modules?: string[];
  target_date?: string | null;
  stage?: WaveStage;
  min_readiness?: number;
  min_dqs?: number | null;
}
export interface WaveCreate {
  name: string;
  modules: string[];
  target_date?: string | null;
  stage: WaveStage;
  min_readiness: number;
  source_system_id?: string | null;
  target_system_id?: string | null;
  target_release?: string;
}

export const getWaves = async (): Promise<MigrationWave[]> => (await v2Get<{ waves: MigrationWave[] }>("/migration/waves")).waves;
export const createWave = (body: WaveCreate): Promise<MigrationWave> => v2Send("POST", "/migration/waves", body);
export const updateWave = (id: string, body: WavePatch): Promise<MigrationWave> => v2Send("PATCH", `/migration/waves/${enc(id)}`, body);
export const deleteWave = (id: string): Promise<void> => v2Send("DELETE", `/migration/waves/${enc(id)}`);
/** POST /migration/waves/{id}/signoff: signs a wave off. Needs approve; the server refuses a wave whose verdict is not go (409). */
export const signOffWave = (id: string): Promise<MigrationWave> => v2Send("POST", `/migration/waves/${enc(id)}/signoff`);

/** POST /migration/waves/{id}/run: analyses the whole wave (every object in it). Needs analyse; 400 when the wave has no source system or no object. */
export const runWave = (id: string): Promise<{ run_id: string; task_id: string; status: string; modules: string[] }> => v2Send("POST", `/migration/waves/${enc(id)}/run`);

/** GET /migration/waves/{id}/cockpit: per-object verdict, the top blockers and the wave's one score threshold (null: none set). */
export type WaveCockpitRead = WaveCockpit & { threshold: number | null };
export const getWaveCockpit = (id: string): Promise<WaveCockpitRead> => v2Get(`/migration/waves/${enc(id)}/cockpit`);

/** GET /migration/waves/{id}/report.{xlsx|pdf}: the readiness report. Needs export. */
export type WaveReportFormat = "xlsx" | "pdf";
export const downloadWaveReport = (id: string, fmt: WaveReportFormat): Promise<string> => v2Download(`/migration/waves/${enc(id)}/report.${fmt}`, undefined, `migration_readiness.${fmt}`);

/** POST /migration/waves/{id}/blockers/fix-batch: drafts a cleaning batch for the open issues on the records one blocker holds. Needs apply. */
export interface FixBatchDraft {
  id: string;
  status: string;
  items: number;
  with_proposal: number;
  auto_approvable: number;
}
export const draftBlockerFixBatch = (id: string, body: { module: string; gap_type?: string; field?: string | null; record_keys?: string[] }): Promise<FixBatchDraft> => v2Send("POST", `/migration/waves/${enc(id)}/blockers/fix-batch`, body);
