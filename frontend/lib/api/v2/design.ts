/**
 * Source design of one connected system (api/routes/source_design.py): what discovery read from its data dictionary,
 * each table and field against the SAP standard, the live check-table values against the standard lists the rules
 * fall back to, and the drift between two discoveries.
 *
 * POST /systems/{id}/discover, GET /systems/{id}/design, GET /systems/{id}/design/tables,
 * GET /systems/{id}/design/tables/{table}, GET /systems/{id}/design/config-deviation,
 * GET /systems/{id}/design/config/{table}, GET /systems/{id}/design/coverage, GET /systems/{id}/design/snapshots, GET /systems/{id}/design/diff.
 */
import { v2Get, v2Send } from "./client";

const enc = encodeURIComponent;

export interface DesignSnapshot {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  tables: number | null;
  customer_tables: number | null;
  customer_fields: number | null;
  error: string | null;
}

export interface DesignSummary {
  system_type: string;
  discovery_status: string | null;
  discovered_at: string | null;
  sap_release: string | null;
  sap_product: string | null;
  config_sync_status: string | null;
  config_synced_at: string | null;
  snapshot: (DesignSnapshot & { source: string | null; coverage_summary: Record<string, number> }) | null;
  configuration: { table: string; scope: string | null; rows: number | null; source: string | null; synced_at: string | null }[];
}

export interface DesignTable {
  table: string;
  description: string | null;
  category: string | null;
  delivery_class: string | null;
  customer_table: boolean;
  field_count: number | null;
  customer_fields: number;
}

export interface DesignField {
  name: string;
  type?: string | null;
  length?: number | null;
  decimals?: number | null;
  key?: boolean;
  description?: string | null;
  check_table?: string | null;
  customer_field?: boolean;
  standard: { type: string | null; length: number | null; decimals: number | null; domain: string | null } | null;
  /** "customer_field", "not_in_standard" or "differs_from_standard (...)"; null when it matches the standard. */
  deviation: string | null;
}

export interface DesignTableDetail {
  table: string;
  description: string | null;
  category: string | null;
  delivery_class: string | null;
  customer_table: boolean;
  in_sap_standard: boolean;
  fields: DesignField[];
  standard_fields_missing: string[];
}

export interface ConfigDeviation {
  reference: string;
  live_count: number;
  standard_count: number;
  custom: string[];
  missing: string[];
}

export interface DesignChange {
  table: string;
  field?: string;
  change: "table_added" | "table_removed" | "field_added" | "field_removed" | "field_changed";
  diff?: Record<string, [unknown, unknown]>;
}

export const getDesign = (id: string) => v2Get<DesignSummary>(`/systems/${enc(id)}/design`);
export const getDesignTables = (id: string, search: string, customerOnly: boolean) =>
  v2Get<{ total: number; items: DesignTable[] }>(`/systems/${enc(id)}/design/tables`, { search: search || undefined, customer_only: customerOnly || undefined, limit: 200 });
export const getDesignTable = (id: string, table: string) => v2Get<DesignTableDetail>(`/systems/${enc(id)}/design/tables/${enc(table)}`);
/** One configuration table as read from the system: rows are the stored check-table entries, as the system returned them. */
export interface DesignConfigTable {
  table: string;
  scope: string | null;
  rows: Record<string, unknown>[];
  total: number | null;
  source: string | null;
  synced_at: string | null;
}
/** What discovery managed to read, per part; each entry is one table with its status. */
export interface DesignCoverageEntry {
  table?: string;
  status: string;
  rows?: number;
  detail?: string;
  purpose?: string;
}
export const getDesignConfig = (id: string, table: string) => v2Get<DesignConfigTable>(`/systems/${enc(id)}/design/config/${enc(table)}`, { limit: 500 });
export const getDesignCoverage = (id: string) => v2Get<{ snapshot_id: string | null; coverage: Record<string, DesignCoverageEntry[]>; waiting_for_data?: Record<string, number> }>(`/systems/${enc(id)}/design/coverage`);
export const getConfigDeviation = (id: string) => v2Get<{ tables: ConfigDeviation[] }>(`/systems/${enc(id)}/design/config-deviation`);
export const getDesignSnapshots = (id: string) => v2Get<DesignSnapshot[]>(`/systems/${enc(id)}/design/snapshots`);
export const getDesignDiff = (id: string, from: string, to: string) =>
  v2Get<{ from: string; to: string; changes: DesignChange[] }>(`/systems/${enc(id)}/design/diff`, { from_snapshot: from, to_snapshot: to });
/** Needs trigger_sync. Reads the dictionary, the customer objects and the configuration again. */
export const discoverDesign = (id: string) => v2Send<{ task_id: string; status: string }>("POST", `/systems/${enc(id)}/discover`);
