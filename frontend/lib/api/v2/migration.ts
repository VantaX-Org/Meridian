/**
 * Migration analysis client (api/routes/migration.py): how ready the source data is to load into the target system.
 *
 *   POST   /migration/analyze                   (queue an analysis: source to source, source to target, or S/4 dry run)
 *   GET    /migration/runs                      (the analyses, newest first)
 *   GET    /migration/runs/{id}                 (one analysis with its gaps grouped by object, kind and severity)
 *   GET    /migration/runs/{id}/records         (records that will or will not load, with the reasons)
 *   GET    /migration/runs/{id}/findings        (the field-level gaps, filtered and paged)
 *   POST   /migration/runs/{id}/reconcile       (queue the post-load reconciliation against the target system)
 *   GET    /migration/runs/{id}/reconciliation  (its latest result: counts per table, three scores, stale flag)
 *   GET    /migration/runs/{id}/reconciliation/records  (missing, differing and unexpected records, paged)
 *   GET    /migration/runs/{id}/reconciliation/export   (the result as Excel)
 *   GET    /migration/runs/{id}/findings/export (the gaps as CSV or Excel)
 *   GET    /migration/runs/{id}/value-candidates (source values of one target field, for the value map)
 *   GET/POST/PUT/DELETE /migration/field-map    (source field to target field, per object and target type)
 *   POST   /migration/field-map/seed            (propose the field map from the analysed source)
 *   GET/PUT/DELETE /migration/value-map         (source value to target value, per target field)
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

const P = "/migration";

export type MigrationMode = "source_to_source" | "source_to_destination" | "s4_dry_run";

export interface MigrationRun {
  id: string;
  mode: MigrationMode;
  source_system_id: string | null;
  dest_system_id: string | null;
  source_version_id: string | null;
  target_release: string | null;
  target_connected: boolean | null;
  modules: string[];
  status: string;
  readiness_verdict: "go" | "conditional" | "no-go" | null;
  readiness_score: number | null;
  critical_count: number | null;
  records_total: number | null;
  records_blocked: number | null;
  error_detail: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface GapGroup {
  module: string;
  gap_type: string;
  severity: string;
  grounded: boolean;
  n: number;
  records: number;
  fields: number;
}

export interface MigrationRunDetail {
  run: MigrationRun;
  gap_breakdown: GapGroup[];
  structural_critical: number;
}

export interface MigrationFinding {
  module: string;
  source_table: string | null;
  record_key: string | null;
  source_field: string | null;
  source_value: string | null;
  dest_table: string | null;
  target_field: string | null;
  target_value: string | null;
  gap_type: string;
  severity: string;
  detail: string | null;
  provenance: string | null;
  grounded: boolean;
}

export interface FindingQuery {
  module?: string;
  gap_type?: string;
  severity?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LoadRecord {
  module: string;
  source_table: string | null;
  record_key: string;
  status: "load_fail" | "load_ready";
  reasons: string[];
}

export interface FieldDef {
  type: string | null;
  length: number | null;
  decimals: number | null;
  check_table: string | null;
  description: string | null;
}

export interface FieldMapping {
  id: string;
  module: string;
  source_field: string;
  dest_system_type: string;
  dest_table: string | null;
  dest_field: string | null;
  value_map: boolean | null;
  origin: string | null;
  transform_note: string | null;
  is_confirmed: boolean;
  source_def: FieldDef | null;
  target_def: FieldDef | null;
}

export interface ValueEntry {
  id: string;
  target_field: string;
  source_value: string;
  target_value: string;
  note: string | null;
  updated_at: string | null;
}

export interface AnalyzeBody {
  mode: MigrationMode;
  source_system_id?: string;
  dest_system_id?: string;
  target_release?: string;
  modules: string[];
}

const run = (id: string) => `${P}/runs/${encodeURIComponent(id)}`;

export const getMigrationRuns = () => v2Get<{ runs: MigrationRun[] }>(`${P}/runs`);
export const getMigrationRun = (id: string) => v2Get<MigrationRunDetail>(run(id));
export const getMigrationFindings = (id: string, q: FindingQuery) => v2Get<{ total: number; items: MigrationFinding[] }>(`${run(id)}/findings`, { ...q });
export const getMigrationRecords = (id: string, status: LoadRecord["status"], offset = 0) =>
  v2Get<{ total: number; rows: LoadRecord[] }>(`${run(id)}/records`, { status, limit: 50, offset });
export const getValueCandidates = (id: string, targetField: string) =>
  v2Get<{ target_field: string; values: { source_value: string; records: number }[] }>(`${run(id)}/value-candidates`, { target_field: targetField });
export const exportMigrationFindings = (id: string, q: FindingQuery) =>
  v2Download(`${run(id)}/findings/export`, { format: "xlsx", ...q, limit: undefined, offset: undefined }, `migration-findings-${id}.xlsx`);
export type LoadFileFormat = "csv" | "xlsx";
/** Target load files for the records without blocking gaps; csv arrives as a zip (migration.py export). */
export const exportLoadFiles = (id: string, fmt: LoadFileFormat) =>
  v2Download(`${P}/export/${encodeURIComponent(id)}/${fmt}`, undefined, `migration_${id}.${fmt === "xlsx" ? "xlsx" : "zip"}`);
export const startMigration = (body: AnalyzeBody) => v2Send<{ run_id: string; status: string }>("POST", `${P}/analyze`, body);

export const getFieldMap = (module: string, destType: string) => v2Get<{ mappings: FieldMapping[] }>(`${P}/field-map`, { module, dest_system_type: destType });
export const addFieldMapping = (body: { module: string; dest_system_type: string; source_field: string; dest_table: string; dest_field: string; transform_note?: string }) =>
  v2Send<FieldMapping>("POST", `${P}/field-map`, body);
export const updateFieldMapping = (id: string, body: Partial<Pick<FieldMapping, "dest_table" | "dest_field" | "transform_note" | "is_confirmed">>) =>
  v2Send<FieldMapping>("PUT", `${P}/field-map/${encodeURIComponent(id)}`, body);
export const deleteFieldMapping = (id: string) => v2Send<unknown>("DELETE", `${P}/field-map/${encodeURIComponent(id)}`);
export const seedFieldMap = (module: string, destType: string, sourceSystemId?: string) =>
  v2Send<{ seeded: number }>("POST", `${P}/field-map/seed`, { module, dest_system_type: destType, source_system_id: sourceSystemId });

export const getValueMap = (module: string, targetField: string) => v2Get<{ entries: ValueEntry[] }>(`${P}/value-map`, { module, target_field: targetField });
export const saveValueMap = (module: string, targetField: string, entries: { source_value: string; target_value: string; note?: string }[]) =>
  v2Send<{ saved: number }>("PUT", `${P}/value-map`, { module, target_field: targetField, entries });
export const deleteValueEntry = (id: string) => v2Send<unknown>("DELETE", `${P}/value-map/${encodeURIComponent(id)}`);

// Post-load reconciliation: did the records the load files carried land in the target system (migration.py).
export type ReconKind = "missing" | "differing" | "unexpected";

export interface ReconField {
  field: string;
  description: string;
  in_target_extract: boolean;
  compared: number;
  matched: number;
  differing: number;
}

export interface ReconTable {
  table: string;
  description: string;
  comparable: boolean;
  /** Why the table could not be compared (no_key_in_dictionary, key_not_in_load, target_extract_incomplete, ...). */
  reason: string | null;
  key_fields: string[];
  expected: number;
  found: number;
  missing: number;
  unexpected: number;
  duplicate_expected: number;
  duplicate_found: number;
  fields: ReconField[];
  records_total: Record<ReconKind, number>;
  capped: boolean;
  unmapped_keys?: string[];
}

export interface ReconReason {
  check_id: string;
  description: string | null;
  severity: string;
  dimension: string;
  source_pass_rate: number | null;
  target_pass_rate: number | null;
  change: number;
}

export interface ReconScores {
  module: string;
  source: number | null;
  projected: number | null;
  /** Null when the target has no completed analysis (actual_reason says why); never estimated. */
  actual: number | null;
  actual_reason: "no_target_analysis" | "no_target_findings_for_module" | null;
  reasons: ReconReason[];
}

export interface Reconciliation {
  reconciliation_id: string;
  run_id: string;
  status: "queued" | "running" | "done" | "failed";
  error_detail: string | null;
  target_system_id: string | null;
  target_version_id: string | null;
  target_synced_at: string | null;
  created_at: string;
  completed_at: string | null;
  /** A target extraction newer than the one compared has landed since. */
  stale: boolean;
  latest_target_synced_at: string | null;
  record_cap: number | null;
  summary: { tables?: number; comparable?: number; expected?: number; found?: number; missing?: number; unexpected?: number; differing_fields?: number;
    /** What the expected side was built from: the files exported (snapshot) or the mappings as they stand (rebuilt). Absent on older results. */
    basis?: "snapshot" | "rebuilt"; snapshot_export_id?: string; snapshot_exported_at?: string; snapshot_skipped?: string };
  tables: ReconTable[];
  scores: ReconScores[];
}

export interface ReconRecord {
  kind: ReconKind;
  key: string;
  source_record: string | null;
  field: string | null;
  expected: string | null;
  found: string | null;
  withheld?: boolean;
}

export interface ReconRecordsPage {
  table: string | null;
  kind: ReconKind | null;
  total: number;
  capped: boolean;
  record_cap: number | null;
  rows: ReconRecord[];
}

export const getReconciliation = (id: string) => v2Get<Reconciliation>(`${run(id)}/reconciliation`);
export const startReconciliation = (id: string) => v2Send<{ reconciliation_id: string; task_id: string | null; status: string }>("POST", `${run(id)}/reconcile`);
export const getReconciliationRecords = (id: string, q: { table?: string; kind?: ReconKind; offset?: number; limit?: number }) =>
  v2Get<ReconRecordsPage>(`${run(id)}/reconciliation/records`, { ...q });
export const exportReconciliation = (id: string) =>
  v2Download(`${run(id)}/reconciliation/export`, undefined, `post_load_reconciliation_${id}.xlsx`);
