import apiClient from "./client";
import type { Version, VersionList, VersionComparison } from "@/types/api";

export async function getVersions(params?: {
  limit?: number;
  offset?: number;
  module?: string;
  system_id?: string;
}): Promise<VersionList> {
  const { data } = await apiClient.get<VersionList>("/api/v1/versions", {
    params,
  });
  return data;
}

/* Hide finished runs from every list, keeping the newest `keepLatest`. Nothing is deleted. */
export async function archiveVersions(keepLatest = 1): Promise<{ archived: number }> {
  const { data } = await apiClient.post("/api/v1/versions/archive", null, { params: { keep_latest: keepLatest } });
  return data;
}

export async function restoreVersions(): Promise<{ restored: number }> {
  const { data } = await apiClient.post("/api/v1/versions/restore");
  return data;
}

export async function getVersion(id: string): Promise<Version> {
  const { data } = await apiClient.get<Version>(`/api/v1/versions/${id}`);
  return data;
}

export async function compareVersions(
  v1: string | undefined,
  v2: string,
  module?: string
): Promise<VersionComparison> {
  const { data } = await apiClient.get<VersionComparison>(
    "/api/v1/versions/compare",
    { params: { v1, v2, module } }
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

export interface RecordDiff {
  v1: string;
  v2: string;
  totals: { new: number; resolved: number; persisting: number };
  checks: RecordDiffCheck[];
}

export async function compareRecords(
  v2: string,
  v1?: string,
  module?: string
): Promise<RecordDiff> {
  const { data } = await apiClient.get("/api/v1/versions/compare/records", { params: { v1, v2, module } });
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

export interface FindingRecord {
  /** SAP record key, e.g. "LIFNR=0000100001|BUKRS=1000". */
  record_key: string;
  grain: string | null;
  module: string;
  /** The rule's column values ("TABLE.FIELD" → value); privacy-sensitive ones arrive masked. Null for older runs. */
  field_values: Record<string, string> | null;
}

/** The records one check found failing in one version. */
export async function getFindingRecords(
  versionId: string,
  checkId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<{ version_id: string; check_id: string; total: number; records: FindingRecord[] }> {
  const { data } = await apiClient.get(
    `/api/v1/versions/${versionId}/findings/${encodeURIComponent(checkId)}/records`, { params });
  return data;
}
