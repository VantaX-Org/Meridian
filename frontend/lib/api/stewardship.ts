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

/** Assign a task to a steward; `null` releases it back to the unassigned pool. */
export async function assignItem(
  id: string,
  userId: string | null
): Promise<{ id: string; status: string; assigned_to?: string | null }> {
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

/** A person a blocking rule can be handed to: an active user who can fix data (api/routes/stewardship.py). */
export interface HandoffSteward { id: string; name: string | null; email: string; role: string }

/** One blocking rule handed to a steward: the rule, where it blocks, who fixes it, why and by when. */
export interface HandoffBody {
  check_id: string;
  module: string;
  assignee_id: string;
  note: string;
  /** yyyy-mm-dd, today or later. */
  due_date: string;
  version_id?: string;
  finding_id?: string;
  /** Where the rule blocks (an L1 process name), for the task title. */
  process?: string;
  field?: string;
}

export interface HandoffResult { task_id: string; exception_id: string; assigned_to: string; due_at: string }

/** Users who can fix, for the hand-off picker. Needs `handoff_rule`, never `assign`. */
export async function getHandoffStewards(): Promise<HandoffSteward[]> {
  const { data } = await apiClient.get("/api/v1/stewardship/handoff/stewards");
  return data;
}

/** Create the task (an exception on the rule plus its inbox task), assigned to the chosen steward. */
export async function handoffRule(body: HandoffBody): Promise<HandoffResult> {
  const { data } = await apiClient.post("/api/v1/stewardship/handoff", body);
  return data;
}
