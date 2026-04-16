import apiClient from "./client";
import type {
  Exception,
  ExceptionListResponse,
  ExceptionMetrics,
  ExceptionRule,
  ExceptionBilling,
  ExceptionComment,
} from "@/types/api";

export async function getExceptions(params: {
  type?: string;
  status?: string;
  severity?: string;
  assigned_to?: string;
  category?: string;
  page?: number;
  per_page?: number;
}): Promise<ExceptionListResponse> {
  const { data } = await apiClient.get("/api/v1/exceptions", { params });
  return data;
}

export async function getException(id: string): Promise<Exception> {
  const { data } = await apiClient.get(`/api/v1/exceptions/${id}`);
  return data;
}

export async function createException(body: {
  type: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affected_records?: Record<string, unknown>;
  object_type?: string;
}): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/exceptions", body);
  return data;
}

export async function assignException(
  id: string,
  body: { user_id: string; user_name?: string }
): Promise<{ id: string; assigned_to: string }> {
  const { data } = await apiClient.put(`/api/v1/exceptions/${id}/assign`, body);
  return data;
}

export async function escalateException(
  id: string,
  body: { reason: string; tier?: number }
): Promise<{ id: string; escalation_tier: number; sla_deadline: string }> {
  const { data } = await apiClient.put(
    `/api/v1/exceptions/${id}/escalate`,
    body
  );
  return data;
}

export async function resolveException(
  id: string,
  body: {
    resolution_type: string;
    resolution_notes: string;
    root_cause_category: string;
  }
): Promise<{ id: string; status: string; billing_tier: number }> {
  const { data } = await apiClient.put(
    `/api/v1/exceptions/${id}/resolve`,
    body
  );
  return data;
}

export async function addComment(
  id: string,
  body: { text: string; user_name?: string }
): Promise<{ comments: ExceptionComment[] }> {
  const { data } = await apiClient.post(
    `/api/v1/exceptions/${id}/comment`,
    body
  );
  return data;
}

export async function getSAPMonitor(): Promise<{
  exceptions: Exception[];
  by_category: Record<string, Exception[]>;
}> {
  const { data } = await apiClient.get("/api/v1/exceptions/sap-monitor");
  return data;
}

export async function getExceptionRules(): Promise<{
  rules: ExceptionRule[];
}> {
  const { data } = await apiClient.get("/api/v1/exceptions/rules");
  return data;
}

export async function createExceptionRule(body: {
  name: string;
  description: string;
  rule_type: string;
  object_type: string;
  condition: string;
  severity: string;
  auto_assign_to?: string;
}): Promise<{ id: string; is_active: boolean }> {
  const { data } = await apiClient.post("/api/v1/exceptions/rules", body);
  return data;
}

export async function updateExceptionRule(
  id: string,
  body: Partial<{
    name: string;
    description: string;
    rule_type: string;
    object_type: string;
    condition: string;
    severity: string;
    auto_assign_to: string;
    is_active: boolean;
  }>
): Promise<ExceptionRule> {
  const { data } = await apiClient.put(`/api/v1/exceptions/rules/${id}`, body);
  return data;
}

export async function getExceptionMetrics(
  period?: string
): Promise<ExceptionMetrics> {
  const { data } = await apiClient.get("/api/v1/exceptions/metrics", {
    params: period ? { period } : {},
  });
  return data;
}

export async function getExceptionBilling(
  period: string
): Promise<ExceptionBilling> {
  const { data } = await apiClient.get("/api/v1/exceptions/billing", {
    params: { period },
  });
  return data;
}
