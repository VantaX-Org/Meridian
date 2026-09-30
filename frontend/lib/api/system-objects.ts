import apiClient from "./client";

export type ScopeKey = "company_codes" | "plants" | "sales_orgs" | "purchasing_orgs";

export interface DownloadScope {
  company_codes?: string[];
  plants?: string[];
  sales_orgs?: string[];
  purchasing_orgs?: string[];
  /** YYYY-MM-DD — replaces the default window of transactional tables. */
  date_from?: string;
  date_to?: string;
}

export interface SystemObject {
  object: string;
  tables: string[];
  config_tables: string[];
  scope_filters: ScopeKey[];
  date_window: string[];
  last_download: { version_id: string; at: string; status: string; records: number | null } | null;
}

export interface SystemVersion {
  id: string;
  run_at: string;
  label: string | null;
  status: string;
  objects: string[];
  scope: DownloadScope;
  records: Record<string, number>;
  analysed_at: string | null;
  rule_set: string | null;
  baseline: boolean;
  analysable: boolean;
  dqs: Record<string, number | null>;
}

export type TrendFlag = "scope_changed" | "rules_changed" | "volume_shift";

export interface TrendPoint {
  version_id: string;
  run_at: string;
  label: string | null;
  baseline: boolean;
  dqs: number | null;
  dqs_delta?: number;
  dimensions: Record<string, number | null>;
  records: number | null;
  failing_records: number;
  failing_records_delta?: number;
  failing_checks: number;
  issues_opened: number;
  issues_resolved: number;
  scope: DownloadScope;
  rule_set: string | null;
  comparable: boolean;
  flags: TrendFlag[];
}

export interface TrendSummary {
  object: string;
  points: number;
  dqs: number | null;
  dqs_delta?: number;
  failing_records: number;
  failing_records_delta?: number;
  comparable: boolean;
  flags: TrendFlag[];
  vs_baseline: { version_id: string; pinned: boolean; dqs_delta: number; failing_records_delta: number } | null;
}

const base = (id: string) => `/api/v1/systems/${id}`;

export async function getSystemObjects(id: string): Promise<{ system_type: string; objects: SystemObject[] }> {
  return (await apiClient.get(`${base(id)}/objects`)).data;
}

export async function startDownload(
  id: string,
  body: { objects: string[]; scope: DownloadScope; label?: string; analyse: boolean }
): Promise<{ job_id: string; status: string }> {
  return (await apiClient.post(`${base(id)}/downloads`, body)).data;
}

export async function getSystemVersions(id: string): Promise<SystemVersion[]> {
  return (await apiClient.get(`${base(id)}/versions`)).data.versions;
}

export async function getTrends(
  id: string,
  object?: string
): Promise<{ summary: TrendSummary[]; series: Record<string, TrendPoint[]> }> {
  return (await apiClient.get(`${base(id)}/trends`, { params: { object } })).data;
}

export async function analyseVersion(versionId: string): Promise<{ status: string }> {
  return (await apiClient.post(`/api/v1/versions/${versionId}/analyse`)).data;
}
