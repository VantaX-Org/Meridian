import apiClient from "./client";

export interface CoverageItem {
  table: string;
  status: "live" | "not_found" | "failed" | string;
  rows?: number;
  detail?: string;
}

export interface DesignSummary {
  system_type: string;
  discovery_status: string | null;
  discovered_at: string | null;
  sap_release: string | null;
  sap_product: string | null;
  config_sync_status: string | null;
  config_synced_at: string | null;
  snapshot: {
    id: string;
    status: string;
    source: string;
    started_at: string | null;
    completed_at: string | null;
    system_info: Record<string, string> | null;
    error: string | null;
    tables: number;
    customer_tables: number;
    customer_fields: number;
    coverage_summary: Record<string, number>;
  } | null;
  configuration: { table: string; scope: string; rows: number; source: string; synced_at: string | null }[];
}

export interface DesignTableRow {
  table: string;
  description: string | null;
  category: string | null;
  delivery_class: string | null;
  customer_table: boolean;
  field_count: number;
  customer_fields: number;
}

export interface DesignField {
  name: string;
  key?: boolean;
  type: string | null;
  length: number | null;
  decimals?: number | null;
  domain?: string | null;
  data_element?: string | null;
  description?: string;
  check_table?: string | null;
  customer_field?: boolean;
  standard: { type: string | null; length: number; decimals: number; domain: string | null } | null;
  deviation: string | null;
}

export interface DesignTable {
  table: string;
  description: string | null;
  category: string | null;
  delivery_class: string | null;
  customer_table: boolean;
  in_sap_standard: boolean;
  fields: DesignField[];
  standard_fields_missing: string[];
  foreign_keys: { field?: string; check_table?: string }[];
}

export interface DesignSnapshot {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  tables: number;
  customer_tables: number;
  customer_fields: number;
  error: string | null;
}

export interface DesignChange {
  table: string;
  field?: string;
  change: "table_added" | "table_removed" | "field_added" | "field_removed" | "field_changed";
  diff?: Record<string, [unknown, unknown]>;
}

const base = (id: string) => `/api/v1/systems/${id}`;

export async function discoverSystem(id: string): Promise<{ task_id: string; status: string }> {
  return (await apiClient.post(`${base(id)}/discover`)).data;
}
export async function getDesign(id: string): Promise<DesignSummary> {
  return (await apiClient.get(`${base(id)}/design`)).data;
}
export async function getDesignCoverage(id: string): Promise<{ snapshot_id: string | null; coverage: Record<string, CoverageItem[]> }> {
  return (await apiClient.get(`${base(id)}/design/coverage`)).data;
}
export async function getDesignTables(
  id: string,
  params: { search?: string; customer_only?: boolean; limit?: number; offset?: number }
): Promise<{ total: number; items: DesignTableRow[] }> {
  return (await apiClient.get(`${base(id)}/design/tables`, { params })).data;
}
export async function getDesignTable(id: string, table: string): Promise<DesignTable> {
  return (await apiClient.get(`${base(id)}/design/tables/${encodeURIComponent(table)}`)).data;
}
export async function getDesignConfig(
  id: string,
  table: string
): Promise<{ table: string; scope: string; rows: Record<string, unknown>[]; total: number; source: string; synced_at: string | null }> {
  return (await apiClient.get(`${base(id)}/design/config/${encodeURIComponent(table)}`)).data;
}
export interface ConfigDeviation {
  reference: string;
  live_count: number;
  standard_count: number;
  custom: string[];
  missing: string[];
}
export async function getConfigDeviation(id: string): Promise<{ tables: ConfigDeviation[] }> {
  return (await apiClient.get(`${base(id)}/design/config-deviation`)).data;
}
export async function getDesignSnapshots(id: string): Promise<DesignSnapshot[]> {
  return (await apiClient.get(`${base(id)}/design/snapshots`)).data;
}
export async function getDesignDiff(id: string, from: string, to: string): Promise<{ changes: DesignChange[] }> {
  return (await apiClient.get(`${base(id)}/design/diff`, { params: { from_snapshot: from, to_snapshot: to } })).data;
}
