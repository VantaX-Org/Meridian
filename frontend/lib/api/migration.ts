import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type {
  MigrationGapFinding,
  MigrationMode,
  MigrationRun,
  MigrationRunDetail,
  TransferFieldMapping,
  TransferValueMapping,
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

// Axios wraps a streamed error body as a Blob — unwrap it so the gate's 409
// reason surfaces instead of a generic "Request failed".
async function readBlobError(blob: Blob): Promise<string | null> {
  try {
    const text = await blob.text();
    return (JSON.parse(text) as { detail?: string }).detail ?? null;
  } catch {
    return null;
  }
}

async function download(url: string, params: object, fallbackName: string): Promise<void> {
  let response: AxiosResponse<Blob>;
  try {
    response = await apiClient.get<Blob>(url, { responseType: "blob", params });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      const detail = await readBlobError(data);
      if (detail) throw new Error(detail);
    }
    throw err;
  }

  const disposition = response.headers["content-disposition"] ?? "";
  const filename =
    disposition.match(/filename=(.+)/)?.[1] ?? fallbackName;
  const href = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(href);
}

/** Target load files for transfer-ready records (blocked records are excluded). */
export function downloadMigrationExport(runId: string, format: ExportFormat): Promise<void> {
  return download(`/api/v1/migration/export/${runId}/${format}`, {}, `migration_${runId}.${format === "csv" ? "zip" : "xlsx"}`);
}

/** The run's gap list (remediation work list). */
export function downloadMigrationGaps(runId: string, format: ExportFormat, filter: GapFilter = {}): Promise<void> {
  return download(`/api/v1/migration/runs/${runId}/findings/export`, { format, ...filter }, `migration_gaps_${runId}.${format}`);
}
