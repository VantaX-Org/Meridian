import apiClient from "./client";
import type { FindingList, FindingReportContext } from "@/types/api";

export async function getFindings(params: {
  version_id?: string;
  module?: string;
  severity?: string;
  dimension?: string;
  limit?: number;
  offset?: number;
}): Promise<FindingList> {
  const { data } = await apiClient.get<FindingList>("/api/v1/findings", {
    params,
  });
  return data;
}

export async function getFindingReportContext(
  findingId: string,
): Promise<FindingReportContext> {
  const { data } = await apiClient.get<FindingReportContext>(
    `/api/v1/findings/${findingId}/report-context`,
  );
  return data;
}
