import apiClient from "./client";
import { downloadAuthenticated } from "./download";
import type {
  MigrationRun,
  MigrationRunDetail,
  TransferFieldMapping,
} from "@/types/api";

export type MigrationMode = "source_to_source" | "source_to_destination";
export type ExportFormat = "csv" | "lsmw" | "bapi" | "idoc" | "sf_csv" | "xlsx";

export async function startMigration(body: {
  mode: MigrationMode;
  source_system_id: string;
  dest_system_id?: string;
  modules: string[];
}): Promise<{ run_id: string; task_id: string; status: string }> {
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

export async function getMigrationRun(
  runId: string
): Promise<MigrationRunDetail> {
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
  id: string,
  body: Partial<
    Pick<
      TransferFieldMapping,
      "dest_table" | "dest_field" | "transform_note" | "is_confirmed"
    >
  >
): Promise<void> {
  await apiClient.put(`/api/v1/migration/field-map/${id}`, body);
}

export async function seedFieldMap(
  module: string,
  destSystemType: string
): Promise<{ seeded: number }> {
  const { data } = await apiClient.post("/api/v1/migration/field-map/seed", {
    module,
    dest_system_type: destSystemType,
  });
  return data;
}

export async function downloadMigrationExport(
  runId: string,
  format: ExportFormat
): Promise<void> {
  await downloadAuthenticated(
    `/api/v1/migration/export/${runId}/${format}`,
    `migration_${runId}.${format === "xlsx" ? "xlsx" : "txt"}`
  );
}
