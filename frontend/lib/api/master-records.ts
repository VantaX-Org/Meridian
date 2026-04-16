import apiClient from "./client";
import type {
  MasterRecordDetail,
  MasterRecordListResponse,
  MasterRecordHistoryEntry,
} from "@/types/api";

export async function getMasterRecords(params?: {
  domain?: string;
  status?: string;
  min_confidence?: number;
  max_confidence?: number;
  page?: number;
  per_page?: number;
}): Promise<MasterRecordListResponse> {
  const { data } = await apiClient.get<MasterRecordListResponse>(
    "/api/v1/master-records",
    { params }
  );
  return data;
}

export async function getMasterRecord(
  id: string
): Promise<MasterRecordDetail> {
  const { data } = await apiClient.get<MasterRecordDetail>(
    `/api/v1/master-records/${id}`
  );
  return data;
}

export async function promoteMasterRecord(
  id: string,
  aiRecommendationAccepted?: boolean
): Promise<{ status: string; promoted_at: string }> {
  const { data } = await apiClient.post(
    `/api/v1/master-records/${id}/promote`,
    { ai_recommendation_accepted: aiRecommendationAccepted }
  );
  return data;
}

export async function writebackMasterRecord(
  id: string
): Promise<{
  record_id: string;
  domain: string;
  golden_fields: Record<string, unknown>;
  message: string;
}> {
  const { data } = await apiClient.post(
    `/api/v1/master-records/${id}/writeback`
  );
  return data;
}

export async function getMasterRecordHistory(
  id: string
): Promise<MasterRecordHistoryEntry[]> {
  const { data } = await apiClient.get<MasterRecordHistoryEntry[]>(
    `/api/v1/master-records/${id}/history`
  );
  return data;
}
