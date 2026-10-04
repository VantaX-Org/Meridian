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
  /** Rules generated from the system's field-status customizing, per segment. */
  field_status: { segment: string; definition: string | null; reason: string | null; rules: number }[];
  extraction_complete: boolean | null;
  coverage: {
    read: number;
    issues: { table: string; status: string; rows: number | null; source_rows: number | null; detail: string | null }[];
  };
  outliers: Record<string, { label: string; outliers: number; checked: number }>;
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

/** The download in flight for a system (or one that just finished or failed). */
export interface DownloadProgress {
  status: "queued" | "running" | "complete" | "failed";
  job_id: string;
  label: string | null;
  objects: string[];
  started_at: string;
  step?: "connecting" | "reading" | "saving";
  table?: string;
  tables_done?: number;
  tables_total?: number;
  rows_read?: number;
  table_rows?: number | null;
  percent?: number;
  error?: string;
  version_id?: string;
}

export async function getSystemVersions(
  id: string
): Promise<{ versions: SystemVersion[]; download: DownloadProgress | null }> {
  return (await apiClient.get(`${base(id)}/versions`)).data;
}

export async function getTrends(
  id: string,
  object?: string,
  allSeries = false
): Promise<{ summary: TrendSummary[]; series: Record<string, TrendPoint[]> }> {
  return (await apiClient.get(`${base(id)}/trends`, { params: { object, all_series: allSeries || undefined } })).data;
}

export async function analyseVersion(versionId: string): Promise<{ status: string }> {
  return (await apiClient.post(`/api/v1/versions/${versionId}/analyse`)).data;
}

export interface ReferenceList {
  kind: string;
  records: number;
  countries: string[];
}

export async function getReferenceLists(id: string): Promise<ReferenceList[]> {
  return (await apiClient.get(`${base(id)}/reference`)).data;
}

/** CSV with columns country,postcode (SAP country key). Replaces the system's current list. */
export async function uploadPostalCodes(id: string, csv: File): Promise<ReferenceList> {
  return (
    await apiClient.post(`${base(id)}/reference/postal-codes`, await csv.text(), {
      headers: { "Content-Type": "text/csv" },
    })
  ).data;
}

/** The licensed SWIFT BIC directory as CSV (first column: BIC). Replaces the system's current directory. */
export async function uploadBicDirectory(id: string, csv: File): Promise<ReferenceList> {
  return (
    await apiClient.post(`${base(id)}/reference/bic`, await csv.text(), {
      headers: { "Content-Type": "text/csv" },
    })
  ).data;
}
