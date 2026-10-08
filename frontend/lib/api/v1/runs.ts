import apiClient from "../client";

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
