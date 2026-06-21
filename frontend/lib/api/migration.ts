import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type {
  MigrationMode,
  MigrationRun,
  MigrationRunDetail,
  TransferFieldMapping,
} from "@/types/api";

export type ExportFormat = "csv" | "lsmw" | "bapi" | "idoc" | "sf_csv" | "xlsx";

export async function startMigration(body: {
  mode: MigrationMode;
  source_system_id: string;
  dest_system_id?: string | null;
  modules: string[];
}): Promise<{ run_id: string; task_id: string; status: string; mode: MigrationMode; modules: string[] }> {
  const { data } = await apiClient.post("/api/v1/migration/analyze", body);
  return data;
}

export async function getMigrationRuns(params?: {
  status?: string;
  mode?: MigrationMode;
}): Promise<MigrationRun[]> {
  const { data } = await apiClient.get<{ runs: MigrationRun[] }>(
    "/api/v1/migration/runs",
    { params }
  );
  return data.runs;
}

export async function getMigrationRun(runId: string): Promise<MigrationRunDetail> {
  const { data } = await apiClient.get<MigrationRunDetail>(
    `/api/v1/migration/runs/${runId}`
  );
  return data;
}

export async function getFieldMap(
  module: string,
  destSystemType: string
): Promise<TransferFieldMapping[]> {
  const { data } = await apiClient.get<{ mappings: TransferFieldMapping[] }>(
    "/api/v1/migration/field-map",
    { params: { module, dest_system_type: destSystemType } }
  );
  return data.mappings;
}

export async function updateFieldMap(
  mappingId: string,
  body: {
    dest_table?: string | null;
    dest_field?: string | null;
    transform_note?: string | null;
    is_confirmed?: boolean;
  }
): Promise<{ id: string; updated: boolean }> {
  const { data } = await apiClient.put(
    `/api/v1/migration/field-map/${mappingId}`,
    body
  );
  return data;
}

export async function seedFieldMap(
  module: string,
  destSystemType: string
): Promise<{ seeded: number; module: string; dest_system_type: string }> {
  const { data } = await apiClient.post("/api/v1/migration/field-map/seed", {
    module,
    dest_system_type: destSystemType,
  });
  return data;
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

export async function downloadMigrationExport(
  runId: string,
  format: ExportFormat
): Promise<void> {
  let response: AxiosResponse<Blob>;
  try {
    response = await apiClient.get<Blob>(
      `/api/v1/migration/export/${runId}/${format}`,
      { responseType: "blob" }
    );
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
    disposition.match(/filename=(.+)/)?.[1] ?? `migration_${runId}.${format}`;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
