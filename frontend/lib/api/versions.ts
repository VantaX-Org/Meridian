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
