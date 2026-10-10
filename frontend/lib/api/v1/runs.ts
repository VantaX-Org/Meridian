import apiClient from "../client";
import { downloadBlob } from "../download";

export interface RunStep {
  step_number: number;
  step_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_detail: string | null;
}

export const getRunSteps = async (versionId: string): Promise<{ version_id: string; steps: RunStep[] }> => {
  const { data } = await apiClient.get<{ version_id: string; steps: RunStep[] }>(
    `/api/v1/runs/${encodeURIComponent(versionId)}/steps`,
  );
  return data;
};

/** GET /api/v1/runs/export — the run list (same filters as getVersions), CSV or XLSX. */
export function exportRuns(
  format: "csv" | "xlsx",
  params?: { limit?: number; module?: string; system_id?: string; include_archived?: boolean },
): Promise<void> {
  return downloadBlob("/api/v1/runs/export", { format, ...params }, `runs.${format}`);
}

/** GET /api/v1/runs/{versionId}/steps/export — the step-by-step history of one run. */
export function exportRunSteps(versionId: string, format: "csv" | "xlsx"): Promise<void> {
  return downloadBlob(`/api/v1/runs/${encodeURIComponent(versionId)}/steps/export`, { format }, `run_steps.${format}`);
}
