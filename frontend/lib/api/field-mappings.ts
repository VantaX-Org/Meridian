import apiClient from "./client";

export interface FieldMapping {
  id: string;
  module: string;
  standard_field: string;
  standard_label: string | null;
  customer_field: string | null;
  customer_label: string | null;
  data_type: string;
  is_mapped: boolean;
  notes: string | null;
  updated_at: string;
}

export interface FieldMappingsListResponse {
  mappings: FieldMapping[];
  total: number;
  self_service_enabled: boolean;
}

export async function getFieldMappings(params?: {
  module?: string;
  is_mapped?: boolean;
  search?: string;
}): Promise<FieldMappingsListResponse> {
  const { data } = await apiClient.get<FieldMappingsListResponse>(
    "/api/v1/field-mappings",
    { params }
  );
  return data;
}

export async function getModuleFieldMappings(
  moduleName: string
): Promise<{ module: string; mappings: FieldMapping[] }> {
  const { data } = await apiClient.get(
    `/api/v1/field-mappings/module/${moduleName}`
  );
  return data;
}

export async function updateFieldMapping(
  mappingId: string,
  body: {
    customer_field?: string;
    customer_label?: string;
    data_type?: string;
    is_mapped?: boolean;
    notes?: string;
  }
): Promise<FieldMapping> {
  const { data } = await apiClient.put<FieldMapping>(
    `/api/v1/field-mappings/${mappingId}`,
    body
  );
  return data;
}

export async function resetFieldMappings(
  module?: string
): Promise<{ reset_count: number; module: string }> {
  const { data } = await apiClient.post("/api/v1/field-mappings/reset", null, {
    params: module ? { module } : undefined,
  });
  return data;
}
