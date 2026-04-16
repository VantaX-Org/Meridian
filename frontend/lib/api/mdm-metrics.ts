import apiClient from "./client";
import type { MdmDashboardResponse, MdmHistoryResponse } from "@/types/api";

export async function getMdmDashboard(): Promise<MdmDashboardResponse> {
  const { data } = await apiClient.get<MdmDashboardResponse>("/api/v1/mdm-metrics");
  return data;
}

export async function getMdmHistory(params?: {
  days?: number;
  domain?: string;
}): Promise<MdmHistoryResponse> {
  const { data } = await apiClient.get<MdmHistoryResponse>("/api/v1/mdm-metrics/history", {
    params,
  });
  return data;
}
