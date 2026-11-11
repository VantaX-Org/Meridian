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
 *   POST   /migration/runs/{id}/extract-target  (extract and analyse the run's objects from its target system, 409 if one is running)
 *   DELETE /migration/runs/{id}                 (the run with its gaps, load files, reconciliations and stored copies; 409 while it runs)
 *   GET    /migration/runs/{id}/findings/export (the gaps as CSV or Excel)
 *   GET    /migration/runs/{id}/value-candidates (source values of one target field, for the value map)
 *   GET/POST/PUT/DELETE /migration/field-map    (source field to target field, per object and target type)
 *   POST   /migration/field-map/seed            (propose the field map from the analysed source)
 *   GET/PUT/DELETE /migration/value-map         (source value to target value, per target field)
 *   POST   /migration/target-workbook/{version_id}/check   (what a finished run can fill in the new system's workbook)
 *   POST   /migration/target-workbook/{version_id}/export  (that data in the workbook's own columns, as Excel or a zip of CSV)
 *   GET/POST /migration/templates/{module}       (the template library: kept target templates, one row per version)
 *   GET    /migration/templates/{module}/fields  (dictionary fields an unresolved column may be mapped to)
 *   GET    /migration/templates/{module}/blank   (a blank template built from the dictionary and the rules)
 *   GET    /migration/templates/{module}/{id}/file     (the template as uploaded)
 *   PUT    /migration/templates/{module}/{id}/mapping  (corrections to unresolved columns, kept per tenant)
 *   POST   /migration/templates/{module}/{id}/check    (what the latest finished run fills, approved cleansing applied)
 *   POST   /migration/templates/{module}/{id}/export   (the filled template, with held rows on a Held back tab)
 */
import { uploadApiClient } from "@/lib/api/client";
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import { fixtureActive } from "./fixture";
import { fixtureWorkbookReport } from "./fixtures/migration";

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
  /** proposed waits for a second person; the load reads confirmed entries only. */
  status?: "proposed" | "confirmed";
  proposed_by?: string | null;
  decided_by?: string | null;
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

export interface WorkbookSheet {
  name: string;
  kind: string;
  /** The source table that fills the sheet; null when nothing in the run does. */
  table: string | null;
  columns: number;
  added_keys: string[];
  matched: number;
  rows: number;
  ready: number;
  held: number;
  known: boolean;
  /** `learned`: the column was added to the extraction from a workbook and arrives with the next run. */
  /** `not_in_system`: the column was learned, but the source system did not return the field on the last run. */
  /** `candidates`: the column's field is on several of the object's tables in DD03L, so none was chosen. */
  unmapped: { id: string; label: string; mandatory: boolean; learned?: boolean; not_in_system?: boolean; candidates?: string[] }[];
}
export type WorkbookFormat = LoadFileFormat | "source";
export interface WorkbookHeldRow { sheet: string; record: string; field: string; reason: string }
export interface WorkbookReport {
  summary: { sheets: number; filled_sheets: number; columns: number; matched_columns: number; mandatory_unmapped: number; rows: number; ready: number; held: number; mandatory_sheets_empty: number; mapped_values: number };
  /** What the upload was read as, and whether it can come back in that layout (`written_as` is the file extension). */
  format: { id: string; same: boolean; written_as: string; skipped: string[] };
  /** Columns a country rule covers on a sheet that does not show the record's country. */
  country_unchecked: { sheet: string; id: string; label: string }[];
  sheets: WorkbookSheet[];
  reasons: Record<string, number>;
  /** The first 200 held rows; `held_total` counts them all. */
  held: WorkbookHeldRow[];
  held_total: number;
  /** Columns Meridian added to the extraction for this system; `waiting` are not in this run yet. */
  learned?: { new: number; waiting: number; missing?: number; system_id: string | null; modules: string[] };
}
const workbookForm = (file: File) => { const form = new FormData(); form.append("file", file); return form; };
/** Reads the new system's workbook against a finished run. Nothing is stored. */
export async function checkTargetWorkbook(versionId: string, file: File): Promise<WorkbookReport> {
  if (fixtureActive()) return fixtureWorkbookReport();
  const { data } = await uploadApiClient.post<WorkbookReport>(`/api/v1${P}/target-workbook/${encodeURIComponent(versionId)}/check`, workbookForm(file), { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}
/** The run's data in the workbook's own columns; csv arrives as a zip. */
export const exportTargetWorkbook = (versionId: string, file: File, fmt: WorkbookFormat, writtenAs = "zip") =>
  v2Download(`${P}/target-workbook/${encodeURIComponent(versionId)}/export`, { format: fmt }, `target_workbook_${versionId}.${fmt === "source" ? writtenAs : fmt === "xlsx" ? "xlsx" : "zip"}`, "post", workbookForm(file));

export interface TemplateCoverage {
  columns: number;
  matched: number;
  sheets: { name: string; table: string | null; columns: number; matched: number; unmapped: { header: string; id: string; label: string; mandatory: boolean }[] }[];
}
export interface TargetTemplate {
  id: string;
  name: string;
  version: number;
  filename: string;
  size_bytes: number;
  coverage: TemplateCoverage | null;
  /** "sheet::header" to TABLE.FIELD, set by a person for columns the template did not resolve. */
  column_map: Record<string, string>;
  last_fill_at: string | null;
  last_fill_version_id: string | null;
  created_by: string | null;
  created_at: string;
}
export interface TemplateField { field: string; description: string; key: boolean; table_description: string }
const tpl = (module: string, id?: string) => `${P}/templates/${encodeURIComponent(module)}${id ? `/${encodeURIComponent(id)}` : ""}`;
export const getTemplates = (module: string) => v2Get<{ module: string; templates: TargetTemplate[] }>(tpl(module));
export const getTemplateFields = (module: string) => v2Get<{ fields: TemplateField[] }>(`${tpl(module)}/fields`);
export async function uploadTemplate(module: string, file: File, name: string): Promise<{ id: string; name: string; version: number; coverage: TemplateCoverage }> {
  if (fixtureActive()) return { id: "tpl-new", name: name || file.name, version: 1, coverage: { columns: 0, matched: 0, sheets: [] } };
  const { data } = await uploadApiClient.post(`/api/v1${tpl(module)}`, workbookForm(file), { params: { name }, headers: { "Content-Type": "multipart/form-data" } });
  return data;
}
export const saveTemplateMapping = (module: string, id: string, columns: Record<string, string>) =>
  v2Send<{ column_map: Record<string, string>; coverage: TemplateCoverage }>("PUT", `${tpl(module, id)}/mapping`, { columns });
export const checkTemplate = (module: string, id: string) => v2Send<WorkbookReport & { version_id: string; cleansed?: { approved: number; cells_changed: number } }>("POST", `${tpl(module, id)}/check`, {});
export const downloadBlankTemplate = (module: string) => v2Download(`${tpl(module)}/blank`, undefined, `${module}_template.xlsx`);
export const downloadTemplateFile = (module: string, t: TargetTemplate) => v2Download(`${tpl(module, t.id)}/file`, undefined, t.filename);
export const exportTemplate = (module: string, t: TargetTemplate, fmt: WorkbookFormat) =>
  v2Download(`${tpl(module, t.id)}/export`, { format: fmt }, `${t.name}_v${t.version}.${fmt === "csv" ? "zip" : "xlsx"}`, "post");

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
  v2Send<{ saved: number; status: string }>("PUT", `${P}/value-map`, { module, target_field: targetField, entries });
/** Four eyes: a different user from the one who proposed the entry approves or rejects it. */
export const decideValueEntry = (id: string, decision: "approve" | "reject") =>
  v2Send<{ id: string; status: string }>("POST", `${P}/value-map/${encodeURIComponent(id)}/decision`, { decision });
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
  /** Differences explained by an expected cause (padding, case, mapping, truncation, format). Absent on older results. */
  expected_differences?: number;
  real_differences?: number;
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
  expected_differences?: number;
  real_differences?: number;
  /** Differences per cause: alpha_padding, case, value_mapping, truncation, number_format, date_format, real. */
  causes?: Record<string, number>;
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
  summary: { tables?: number; comparable?: number; expected?: number; found?: number; missing?: number; unexpected?: number; differing_fields?: number; expected_differences?: number; real_differences?: number;
    /** What the expected side was built from: the files exported (snapshot) or the mappings as they stand (rebuilt). Absent on older results. */
    basis?: "snapshot" | "rebuilt"; snapshot_export_id?: string; snapshot_exported_at?: string; snapshot_skipped?: string;
    /** The newest export kept no copy: over the size limit, a storage failure, or removed. */
    newest_export_no_copy?: boolean };
  tables: ReconTable[];
  scores: ReconScores[];
  /** Started by a finished target analysis, not by a person. */
  automatic: boolean;
  /** It failed because the target system has no completed analysis: extracting it is the one action. */
  needs_target_extraction: boolean;
  /** The reconciliation before this one, counts only. Null when there is none. */
  previous: { created_at: string; summary: Reconciliation["summary"] } | null;
}

export interface ReconRecord {
  kind: ReconKind;
  key: string;
  source_record: string | null;
  field: string | null;
  expected: string | null;
  found: string | null;
  withheld?: boolean;
  /** Why a differing value differs: an expected cause, or real. Absent on older results and on missing/unexpected rows. */
  cause?: ReconCause | null;
  /** The target field's dictionary entry the cause was judged against. */
  ddic?: ReconDdic | null;
}

export type ReconCause = "alpha_padding" | "case" | "value_mapping" | "truncation" | "number_format" | "date_format" | "real";

export interface ReconDdic {
  description: string;
  type: string | null;
  length: number | null;
  conversion_exit: string | null;
  lowercase: boolean | null;
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
export const getReconciliationRecords = (id: string, q: { table?: string; kind?: ReconKind; offset?: number; limit?: number; real_only?: boolean }) =>
  v2Get<ReconRecordsPage>(`${run(id)}/reconciliation/records`, { ...q, real_only: q.real_only ? "true" : undefined });
export const exportReconciliation = (id: string) =>
  v2Download(`${run(id)}/reconciliation/export`, undefined, `post_load_reconciliation_${id}.xlsx`);
export const extractMigrationTarget = (id: string) => v2Send<{ job_id: string; version_id: string; status: string; modules: string[] }>("POST", `${run(id)}/extract-target`);
export const deleteMigrationRun = (id: string) => v2Send<unknown>("DELETE", run(id));
