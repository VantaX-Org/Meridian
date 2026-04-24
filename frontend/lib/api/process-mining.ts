import apiClient from "./client";

export interface MiningActivity {
  id: string;
  label: string;
  l3_id: string;
  l3_name: string;
  tcode: string | null;
  step_status: "green" | "amber" | "red";
  affected_records: number;
  finding_count: number;
  avg_pass_rate: number | null;
}

export interface MiningTransition {
  from: string;
  to: string;
  weight: number;
}

export interface MiningVariant {
  id: string;
  label: string;
  tcode: string | null;
  activity_count: number;
  coverage: number;
  readiness: "green" | "amber" | "red";
  quality: number;
  activity_ids: string[];
}

export interface MiningGraphResponse {
  version_id: string;
  module: string;
  activities: MiningActivity[];
  transitions: MiningTransition[];
  variants: MiningVariant[];
  cases: unknown[];
  cases_supported: boolean;
}

export async function getMiningGraph(
  versionId: string,
  module: string,
): Promise<MiningGraphResponse> {
  const { data } = await apiClient.get<MiningGraphResponse>(
    `/api/v1/process/mining/graph/${versionId}/${module}`,
  );
  return data;
}
