import apiClient from "./client";
import type {
  GlossaryListResponse,
  GlossaryTermDetail,
  AIDraftResponse,
  BatchLookupResponse,
} from "@/types/api";

export async function getGlossaryTerms(params?: {
  domain?: string;
  status?: string;
  mandatory_for_s4hana?: boolean;
  ai_drafted?: boolean;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<GlossaryListResponse> {
  const { data } = await apiClient.get<GlossaryListResponse>(
    "/api/v1/glossary",
    { params }
  );
  return data;
}

export async function getGlossaryTerm(
  id: string
): Promise<GlossaryTermDetail> {
  const { data } = await apiClient.get<GlossaryTermDetail>(
    `/api/v1/glossary/${id}`
  );
  return data;
}

export async function requestAIDraft(
  id: string
): Promise<AIDraftResponse> {
  const { data } = await apiClient.post<AIDraftResponse>(
    `/api/v1/glossary/${id}/ai-draft`
  );
  return data;
}

export async function updateGlossaryTerm(
  id: string,
  body: {
    business_name?: string;
    business_definition?: string;
    why_it_matters?: string;
    sap_impact?: string;
    status?: string;
    data_steward_id?: string;
    mandatory_for_s4hana?: boolean;
    approved_values?: Record<string, string> | string[];
    review_cycle_days?: number;
  }
): Promise<{ status: string; changes: number }> {
  const { data } = await apiClient.put(
    `/api/v1/glossary/${id}`,
    body
  );
  return data;
}

export async function reviewGlossaryTerm(
  id: string
): Promise<{ status: string; term_id: string }> {
  const { data } = await apiClient.post(
    `/api/v1/glossary/${id}/review`
  );
  return data;
}

export async function batchLookupGlossary(
  fields: string[]
): Promise<BatchLookupResponse> {
  const { data } = await apiClient.post<BatchLookupResponse>(
    "/api/v1/glossary/batch-lookup",
    { fields }
  );
  return data;
}
