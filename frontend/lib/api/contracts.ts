import apiClient from "./client";
import type {
  ContractListResponse,
  Contract,
  ComplianceHistoryResponse,
  NlpResponse,
  LineageGraph,
} from "@/types/api";

export async function getContracts(
  status?: string,
): Promise<ContractListResponse> {
  const { data } = await apiClient.get<ContractListResponse>(
    "/api/v1/contracts",
    { params: status ? { status } : undefined },
  );
  return data;
}

export async function createContract(body: {
  name: string;
  description?: string;
  producer: string;
  consumer: string;
  schema_contract?: Record<string, unknown>;
  quality_contract?: Record<string, number>;
  freshness_contract?: Record<string, unknown>;
  volume_contract?: Record<string, unknown>;
}): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/contracts", body);
  return data;
}

export async function updateContract(
  id: string,
  body: Partial<{
    name: string;
    description: string;
    producer: string;
    consumer: string;
    schema_contract: Record<string, unknown>;
    quality_contract: Record<string, number>;
    freshness_contract: Record<string, unknown>;
    volume_contract: Record<string, unknown>;
    status: string;
  }>,
): Promise<Contract> {
  const { data } = await apiClient.put(`/api/v1/contracts/${id}`, body);
  return data;
}

export async function activateContract(
  id: string,
): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.put(`/api/v1/contracts/${id}/activate`);
  return data;
}

export async function getContractCompliance(
  id: string,
  days?: number,
): Promise<ComplianceHistoryResponse> {
  const { data } = await apiClient.get<ComplianceHistoryResponse>(
    `/api/v1/contracts/${id}/compliance`,
    { params: days ? { days } : undefined },
  );
  return data;
}

export async function sendNlpQuery(
  question: string,
): Promise<NlpResponse> {
  const { data } = await apiClient.post<NlpResponse>("/api/v1/nlp/query", {
    question,
  });
  return data;
}

export async function getLineage(
  objectType: string,
  recordKey: string,
  depth?: number,
): Promise<LineageGraph> {
  const { data } = await apiClient.get<LineageGraph>(
    `/api/v1/lineage/${objectType}/${recordKey}`,
    { params: depth ? { depth } : undefined },
  );
  return data;
}
