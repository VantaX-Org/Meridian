/**
 * Reports and their schedules, and the migration waves, on the endpoints the current interface uses
 * (api/routes/report_library.py, api/routes/reports.py, api/routes/migration.py).
 */
import type { CatalogueEntry, ReportFilePage, ReportSchedule, ReportScheduleInput, ScheduleOptions } from "@/lib/api/reports";
import type { MigrationWave, WaveStage } from "@/types/api";
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
