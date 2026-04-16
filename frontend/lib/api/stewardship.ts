import apiClient from "./client";
import type {
  StewardshipQueueItem,
  StewardshipQueueListResponse,
  StewardshipMetrics,
} from "@/types/api";

export interface QueueFilters {
  item_type?: string;
  domain?: string;
  status?: string;
  assigned_to?: string;
  priority?: number;
  limit?: number;
  offset?: number;
}

export async function getQueueItems(
  filters: QueueFilters = {}
): Promise<StewardshipQueueListResponse> {
  const params = new URLSearchParams();
  if (filters.item_type) params.set("item_type", filters.item_type);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.status) params.set("status", filters.status ?? "open");
  if (filters.assigned_to) params.set("assigned_to", filters.assigned_to);
  if (filters.priority !== undefined)
    params.set("priority", String(filters.priority));
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  const { data } = await apiClient.get(
    `/api/v1/stewardship?${params.toString()}`
  );
  return data;
}

export async function getQueueItem(
  id: string
): Promise<StewardshipQueueItem> {
  const { data } = await apiClient.get(`/api/v1/stewardship/${id}`);
  return data;
}

export async function assignItem(
  id: string,
  userId: string
): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.put(`/api/v1/stewardship/${id}/assign`, {
    user_id: userId,
  });
  return data;
}

export async function resolveItem(
  id: string,
  action: "approve" | "reject",
  notes?: string
): Promise<{ id: string; status: string; action: string }> {
  const { data } = await apiClient.put(`/api/v1/stewardship/${id}/resolve`, {
    action,
    notes,
  });
  return data;
}

export async function escalateItem(
  id: string
): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.put(`/api/v1/stewardship/${id}/escalate`);
  return data;
}

export async function bulkApprove(
  itemIds: string[],
  minConfidence: number = 0.85
): Promise<{ approved: number; history_rows_created: number }> {
  const { data } = await apiClient.post(`/api/v1/stewardship/bulk-approve`, {
    item_ids: itemIds,
    min_confidence: minConfidence,
  });
  return data;
}

export async function getMetrics(): Promise<StewardshipMetrics> {
  const { data } = await apiClient.get(`/api/v1/stewardship/metrics`);
  return data;
}

export async function submitAiFeedback(body: {
  queue_item_id: string;
  steward_decision: string;
  correction_reason?: string;
  domain: string;
}): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post(`/api/v1/ai/feedback`, body);
  return data;
}
