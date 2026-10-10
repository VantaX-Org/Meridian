import apiClient from "./client";
import { downloadBlob } from "./download";
import type {
  MigrationGapFinding,
  MigrationMode,
  MigrationRun,
  MigrationRunDetail,
  MigrationWave,
  TransferFieldMapping,
  TransferValueMapping,
  WaveCockpit,
  WaveStage,
} from "@/types/api";

/** Load files: one sheet per target table (xlsx) or one CSV per table (zip). */
export type ExportFormat = "csv" | "xlsx";

export async function startMigration(body: {
  mode: MigrationMode;
  source_system_id: string;
  source_version_id?: string | null;
  dest_system_id?: string | null;
  target_release?: string;
  modules: string[];
}): Promise<{ run_id: string; task_id: string; status: string; mode: MigrationMode; modules: string[] }> {
  const { data } = await apiClient.post("/api/v1/migration/analyze", body);
  return data;
}

export async function getMigrationRuns(params?: {
  status?: string;
  mode?: MigrationMode;
}): Promise<MigrationRun[]> {
  const { data } = await apiClient.get<{ runs: MigrationRun[] }>("/api/v1/migration/runs", { params });
  return data.runs;
}

export async function getMigrationRun(runId: string): Promise<MigrationRunDetail> {
  const { data } = await apiClient.get<MigrationRunDetail>(`/api/v1/migration/runs/${runId}`);
  return data;
}

export interface GapFilter {
  module?: string;
  gap_type?: string;
  severity?: string;
  grounded?: boolean;
  search?: string;
}

export async function getMigrationFindings(
  runId: string,
  params: GapFilter & { limit?: number; offset?: number }
): Promise<{ total: number; items: MigrationGapFinding[] }> {
  const { data } = await apiClient.get(`/api/v1/migration/runs/${runId}/findings`, { params });
  return data;
}

export async function getValueCandidates(
  runId: string,
  targetField: string
): Promise<{ source_value: string; records: number }[]> {
  const { data } = await apiClient.get(`/api/v1/migration/runs/${runId}/value-candidates`, {
    params: { target_field: targetField },
  });
  return data.values;
}

export async function getFieldMap(
  module: string,
  destSystemType: string,
  sourceSystemType?: string
): Promise<TransferFieldMapping[]> {
  const { data } = await apiClient.get<{ mappings: TransferFieldMapping[] }>("/api/v1/migration/field-map", {
    params: { module, dest_system_type: destSystemType, source_system_type: sourceSystemType },
  });
  return data.mappings;
}

export async function createFieldMap(body: {
  module: string;
  dest_system_type: string;
  source_field: string;
  dest_table?: string | null;
  dest_field?: string | null;
  value_map?: boolean;
  transform_note?: string | null;
}): Promise<{ id: string }> {
  const { data } = await apiClient.post("/api/v1/migration/field-map", body);
  return data;
}

export async function updateFieldMap(
  mappingId: string,
  body: {
    dest_table?: string | null;
    dest_field?: string | null;
    transform_note?: string | null;
    is_confirmed?: boolean;
    value_map?: boolean;
  }
): Promise<{ id: string; updated: boolean }> {
  const { data } = await apiClient.put(`/api/v1/migration/field-map/${mappingId}`, body);
  return data;
}

export async function deleteFieldMap(mappingId: string): Promise<void> {
  await apiClient.delete(`/api/v1/migration/field-map/${mappingId}`);
}

export async function seedFieldMap(body: {
  module: string;
  dest_system_type: string;
  source_system_id?: string | null;
  source_version_id?: string | null;
}): Promise<{ seeded: number; module: string; dest_system_type: string }> {
  const { data } = await apiClient.post("/api/v1/migration/field-map/seed", body);
  return data;
}

export async function getValueMap(module: string, targetField?: string): Promise<TransferValueMapping[]> {
  const { data } = await apiClient.get("/api/v1/migration/value-map", {
    params: { module, target_field: targetField },
  });
  return data.entries;
}

export async function saveValueMap(body: {
  module: string;
  target_field: string;
  entries: { source_value: string; target_value: string; note?: string | null }[];
}): Promise<{ saved: number }> {
  const { data } = await apiClient.put("/api/v1/migration/value-map", body);
  return data;
}

export async function deleteValueMap(entryId: string): Promise<void> {
  await apiClient.delete(`/api/v1/migration/value-map/${entryId}`);
}

/** Target load files for transfer-ready records (blocked records are excluded). */
export function downloadMigrationExport(runId: string, format: ExportFormat): Promise<void> {
  return downloadBlob(`/api/v1/migration/export/${runId}/${format}`, {}, `migration_${runId}.${format === "csv" ? "zip" : "xlsx"}`);
}

/** The run's gap list (remediation work list). */
export function downloadMigrationGaps(runId: string, format: ExportFormat, filter: GapFilter = {}): Promise<void> {
  return downloadBlob(`/api/v1/migration/runs/${runId}/findings/export`, { format, ...filter }, `migration_gaps_${runId}.${format}`);
}

// ── Migration waves ──────────────────────────────────────────────────────────

export interface WaveInput {
  name: string;
  source_system_id?: string | null;
  target_system_id?: string | null;
  target_release?: string;
  modules: string[];
  target_date?: string | null;
  stage: WaveStage;
  min_readiness: number;
  min_dqs?: number | null;
}

export async function getWaves(): Promise<MigrationWave[]> {
  const { data } = await apiClient.get<{ waves: MigrationWave[] }>("/api/v1/migration/waves");
  return data.waves;
}

export async function createWave(body: WaveInput): Promise<MigrationWave> {
  const { data } = await apiClient.post<MigrationWave>("/api/v1/migration/waves", body);
  return data;
}

export async function updateWave(id: string, body: Partial<WaveInput>): Promise<MigrationWave> {
  const { data } = await apiClient.patch<MigrationWave>(`/api/v1/migration/waves/${id}`, body);
  return data;
}

export async function deleteWave(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/migration/waves/${id}`);
}

export async function runWave(
  id: string,
): Promise<{ run_id: string; task_id: string; status: string; mode: MigrationMode; modules: string[] }> {
  const { data } = await apiClient.post<{
    run_id: string;
    task_id: string;
    status: string;
    mode: MigrationMode;
    modules: string[];
  }>(`/api/v1/migration/waves/${id}/run`);
  return data;
}

export async function getWaveCockpit(id: string): Promise<WaveCockpit> {
  const { data } = await apiClient.get<WaveCockpit>(`/api/v1/migration/waves/${id}/cockpit`);
  return data;
}

export async function signoffWave(id: string): Promise<MigrationWave> {
  const { data } = await apiClient.post<MigrationWave>(`/api/v1/migration/waves/${id}/signoff`);
  return data;
}

export async function createBlockerFixBatch(
  id: string,
  body: { module: string; gap_type: string; field: string | null },
): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>(`/api/v1/migration/waves/${id}/blockers/fix-batch`, body);
  return data;
}

/** `draft_batch` returns the new batch under `id` (api/services/remediation.py:97-148). */
export function downloadWaveReport(id: string, fmt: "xlsx" | "pdf"): Promise<void> {
  return downloadBlob(`/api/v1/migration/waves/${id}/report.${fmt}`, {}, `migration_readiness_${id}.${fmt}`);
}

export interface S4Area {
  area: string;
  label: string;
  simplification_item: string | null;
  rules: number;
  failing: number;
  failing_records: number;
  blocking_failing: number;
  status: string;
}

export async function getS4Readiness(versionId: string): Promise<{ status: string; areas: S4Area[] }> {
  const { data } = await apiClient.get<{ status: string; areas: S4Area[] }>("/api/v1/findings/s4-readiness", {
    params: { version_id: versionId },
  });
  return data;
}
