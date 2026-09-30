import apiClient from "./client";
import type { Version, VersionList, VersionComparison } from "@/types/api";

export async function getVersions(params?: {
  limit?: number;
  offset?: number;
  module?: string;
}): Promise<VersionList> {
  const { data } = await apiClient.get<VersionList>("/api/v1/versions", {
    params,
  });
  return data;
}

export async function getVersion(id: string): Promise<Version> {
  const { data } = await apiClient.get<Version>(`/api/v1/versions/${id}`);
  return data;
}

export async function compareVersions(
  v1: string,
  v2: string
): Promise<VersionComparison> {
  const { data } = await apiClient.get<VersionComparison>(
    "/api/v1/versions/compare",
    { params: { v1, v2 } }
  );
  return data;
}

export async function patchVersionLabel(
  id: string,
  label: string
): Promise<Version> {
  const { data } = await apiClient.patch<Version>(`/api/v1/versions/${id}`, {
    label,
  });
  return data;
}

export interface RecordDiffCheck {
  check_id: string;
  module: string;
  severity: string;
  new: number;
  resolved: number;
  persisting: number;
  /** false when the check errored/was skipped in either run or its key list was truncated. */
  comparable: boolean;
}

export async function compareRecords(
  v2: string,
  v1?: string
): Promise<{ v1: string; v2: string; totals: { new: number; resolved: number; persisting: number }; checks: RecordDiffCheck[] }> {
  const { data } = await apiClient.get("/api/v1/versions/compare/records", { params: { v1, v2 } });
  return data;
}

export async function compareRecordKeys(
  checkId: string,
  params: { v1: string; v2: string; change: "new" | "resolved" | "persisting"; search?: string; limit?: number; offset?: number }
): Promise<{ record_keys: string[] }> {
  const { data } = await apiClient.get(`/api/v1/versions/compare/records/${encodeURIComponent(checkId)}`, { params });
  return data;
}

export async function pinBaseline(id: string, pinned = true): Promise<{ baseline: boolean }> {
  const { data } = await apiClient.post(`/api/v1/versions/${id}/baseline`, null, { params: { pinned } });
  return data;
}
