import apiClient from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import { fixturePost } from "./fixtures/object";
import type { DimensionKey } from "./types";

/**
 * Reads and writes behind the Object tabs (Rules, Runs, Readiness, Records), the rule inspector and the rule canvas.
 * Every GET goes through v2Get, so fixture mode answers from lib/api/v2/fixtures/object.ts; every write goes through
 * v2Post, which in fixture mode changes the in-memory fixture and nothing else.
 */

export type RuleSeverity = "critical" | "high" | "medium" | "low" | "info";

/** A write: a POST on /api/v1, or its fixture stand-in. */
export async function v2Post<T>(path: string, body?: unknown, params?: Record<string, string | undefined>): Promise<T> {
  if (fixtureActive()) return fixturePost<T>(path, body, params ?? {});
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")) : undefined;
  const { data } = await apiClient.post<T>(`/api/v1${path}`, body ?? null, { params: clean });
  return data;
}

/* ---- GET /explain/{metric} ---- */

export type ExplainMetric = "dqs" | "dimension" | "cap" | "coverage" | "value_at_risk" | "failing_pct" | "tolerance" | "open_work";

export interface ExplainRow {
  label: string;
  /** Null: the run did not store it. */
  value: number | string | null;
  unit: string | null;
}

export interface Explain {
  metric: string;
  title: string;
  text: string;
  computation: ExplainRow[];
  module: string | null;
  run_id: string | null;
  run_at: string | null;
}

export interface ExplainArgs {
  module?: string | null;
  run?: string | null;
  dimension?: string | null;
  checkId?: string | null;
}

export function getExplain(metric: ExplainMetric, a: ExplainArgs): Promise<Explain> {
  return v2Get<Explain>(`/explain/${metric}`, { module: a.module ?? undefined, run: a.run ?? undefined, dimension: a.dimension ?? undefined, check_id: a.checkId ?? undefined });
}

/* ---- GET /rules/{check_id}/scope ---- */

export interface RuleDefinition {
  source: string | null;
  check_class: string | null;
  field: string | null;
  table?: string | null;
  dimension: string | null;
  severity: string | null;
  message: string | null;
  expression: string | null;
  params: Record<string, unknown>;
}

export interface RuleAuthority {
  rule_authority: string | null;
  why_it_matters: string | null;
  sap_impact: string | null;
}

export interface ScopeObject {
  system_id: string;
  system_name: string | null;
  module: string;
  label: string;
  run_id: string;
  run_at: string | null;
  severity: string | null;
  failing: number;
  checked: number | null;
  pass_rate: number | null;
}

export interface ScopeSystem {
  id: string;
  name: string | null;
  failing: number;
  objects: number;
}

export interface ScopeFeature {
  feature: string;
  status: "blocked" | "degraded";
  system_id: string | null;
}

export interface ScopeVersion {
  version: number;
  state: string;
  created_at: string | null;
  author: string | null;
  approved_by: string | null;
  note: string | null;
}

export interface ScopeContract {
  id: string;
  name: string;
  status: string;
  via: "names_rule" | "dimension_threshold";
  threshold: number | null;
}

export interface RuleScope {
  check_id: string;
  name: string | null;
  module: string | null;
  definition: RuleDefinition;
  authority: RuleAuthority;
  objects: ScopeObject[];
  systems: ScopeSystem[];
  failing_records: number;
  failing_by_object: { module: string; label: string; failing: number }[];
  features: ScopeFeature[];
  versions: ScopeVersion[];
  shipped: { source: string; hash: string; app_version: string } | null;
  contracts: ScopeContract[];
}

export function getRuleScope(checkId: string, module?: string | null): Promise<RuleScope> {
  return v2Get<RuleScope>(`/rules/${encodeURIComponent(checkId)}/scope`, { module: module ?? undefined });
}

/* ---- GET /rules/{check_id}/reconcile?run= : prove a rule in SAP ---- */

/** SE16's selection options, plus the field's initial value and SE16's multiple selection of single values. */
export type SelectionOperator = "EQ" | "NE" | "GT" | "LT" | "GE" | "LE" | "CP" | "initial" | "not_initial" | "in" | "not_in";

export interface SelectionLine {
  table: string;
  field: string;
  operator: SelectionOperator | string;
  values: string[];
  part: "population" | "failing" | string;
  /** The line in English words, as the workbook writes it. */
  words: string;
}

/** What SE16 alone cannot express: its kind, the identifiers it names and the condition in English words. */
export interface ReconcileCondition {
  kind: string;
  fields: string[];
  params: Record<string, unknown>;
  words: string;
}

export interface ReconcileJoin {
  from_table: string;
  to_table: string;
  on: string[][];
  words: string;
}

export interface ReconcileKey {
  raw: string;
  display: string;
  fields: { field: string | null; raw: string; display: string }[];
}

export interface Reconcile {
  check_id: string;
  module: string;
  label: string;
  run_id: string;
  run_at: string | null;
  run_label: string | null;
  check_class: string | null;
  message: string | null;
  field: string | null;
  system: "abap" | "cloud" | string;
  transaction: string | null;
  tables: string[];
  grain: { table: string | null; key_fields: string[] };
  population_selection: SelectionLine[];
  failing_selection: SelectionLine[];
  conditions: ReconcileCondition[];
  joins: ReconcileJoin[];
  se16: boolean;
  population: number;
  failing: number;
  excluded: Record<string, number>;
  sample_keys: ReconcileKey[];
}

export function getRuleReconcile(checkId: string, run: string): Promise<Reconcile> {
  return v2Get<Reconcile>(`/rules/${encodeURIComponent(checkId)}/reconcile`, { run });
}

/** The reconciliation workbook of a run: the `top` rules with the most failing records, one sheet each. */
export function downloadReconciliationWorkbook(run: string, top = 10): Promise<string> {
  return v2Download(`/runs/${encodeURIComponent(run)}/reconciliation.xlsx`, { top }, "meridian-reconciliation.xlsx");
}

/* ---- GET /rules/{check_id}/history ---- */

export interface RuleRun {
  version_id: string;
  run_at: string;
  module: string;
  severity: string;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
  hit_rate: number;
  suppressed: boolean;
}

export async function getRuleHistory(checkId: string, limit = 12): Promise<RuleRun[]> {
  const res = await v2Get<{ rule_id: string; runs: RuleRun[] }>(`/rules/${encodeURIComponent(checkId)}/history`, { limit });
  return res.runs;
}

/* ---- GET /runs/timeline, /runs/{a}/vs/{b}/summary, /versions/compare ---- */

export interface TimelineObject {
  score: number | null;
  raw_score: number | null;
  capped: boolean;
}

export interface TimelineRun {
  id: string;
  run_at: string | null;
  label: string | null;
  system_id: string | null;
  baseline: boolean;
  kind: string | null;
  objects: Record<string, TimelineObject>;
  records_checked: number | null;
  duration_s: number | null;
}

export interface Timeline {
  system_id: string | null;
  limit: number;
  /** Oldest first. */
  runs: TimelineRun[];
}

export function getTimeline(systemId: string | null | undefined, limit = 8): Promise<Timeline> {
  return v2Get<Timeline>("/runs/timeline", { system_id: systemId ?? undefined, limit });
}

export interface CompareSide {
  score: number | null;
  raw_score: number | null;
  capped: boolean;
  records_checked: number | null;
  coverage: number | null;
}

export interface CompareObject {
  module: string;
  label: string;
  before: CompareSide | null;
  after: CompareSide | null;
  score_change: number | null;
  newly_failing: number;
  fixed: number;
  worse: number;
  better: number;
}

export interface CompareSummary {
  a: { id: string; run_at: string | null; label: string | null };
  b: { id: string; run_at: string | null; label: string | null };
  objects: CompareObject[];
  totals: { newly_failing: number; fixed: number; worse: number; better: number; rules_compared: number; rules_added: number; rules_dropped: number };
  method: string;
}

export function getCompareSummary(a: string, b: string): Promise<CompareSummary> {
  return v2Get<CompareSummary>(`/runs/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}/summary`);
}

export type ChangeKind = "newly_failing" | "fixed" | "worse" | "better";

export interface ChangedCheck {
  check_id: string;
  module: string;
  severity: string;
  message: string | null;
  v1_affected: number;
  v2_affected: number;
}

/**
 * GET /versions/compare: the rules behind the counts of /runs/{a}/vs/{b}/summary. The summary carries counts only;
 * the rule ids come from here, which is the endpoint the summary's counts are computed from.
 */
export async function getChangedChecks(v1: string, v2: string, module: string): Promise<Record<ChangeKind, ChangedCheck[]>> {
  const res = await v2Get<{ checks: Record<ChangeKind, ChangedCheck[]> }>("/versions/compare", { v1, v2, module });
  return res.checks;
}

/* ---- GET /insights/readiness, /config-impact/{run} ---- */

export type CellVerdict = "go" | "at_risk" | "no_go";

export interface ReadinessCell {
  module: string;
  wave: string;
  verdict: CellVerdict;
  blocker_count: number;
  dqs: number | null;
  score: number | null;
  records_blocked: number;
  /** The wave's one threshold: its gate's minimum score, else its own, else the tenant's. */
  threshold?: number | null;
}

export interface Readiness {
  /** The waves' one threshold when they share it, else null (each cell then names its own). */
  threshold: number | null;
  cells: ReadinessCell[];
  configured: boolean;
}

export function getReadiness(): Promise<Readiness> {
  return v2Get<Readiness>("/insights/readiness", { scope: "current" });
}

export interface ImpactFinding {
  check_id: string;
  affected_count?: number;
  module?: string;
  severity?: string;
}

export interface ImpactResult {
  feature: string;
  system: string;
  status: "blocked" | "degraded" | "ok";
  blocking_findings: ImpactFinding[];
  total_affected_records: number | null;
  blocked_transactions: string[];
  opportunity_cost_summary: string;
}

export async function getConfigImpact(run: string): Promise<ImpactResult[]> {
  const res = await v2Get<{ results: ImpactResult[] }>(`/config-impact/${encodeURIComponent(run)}`);
  return res.results;
}

/* ---- GET /work/groups, POST /work/groups/{check_id}/accept-all ---- */

export interface WorkGroupRow {
  check_id: string;
  module: string;
  severity: string;
  records: number;
  /** Records with a machine-proposed value. */
  proposed: number;
  open: number;
}

export async function getWorkGroupsFor(module: string, run: string | null | undefined): Promise<WorkGroupRow[]> {
  const res = await v2Get<{ groups: WorkGroupRow[] }>("/work/groups", { module, version_id: run ?? undefined });
  return res.groups;
}

export function acceptAllSuggested(checkId: string, run: string | null | undefined): Promise<{ accepted: number; draft_batch_id: string }> {
  return v2Post(`/work/groups/${encodeURIComponent(checkId)}/accept-all`, null, { version_id: run ?? undefined });
}

/* ---- GET /learned-rules, /rule-authoring/drafts ---- */

/** Step 9: the evidence of a rule mined from stewards' fixes (api/services/fix_mining.py). */
export interface FixEvidence {
  count: number;
  sample_keys: string[];
  first_at: string | null;
  last_at: string | null;
  who: string[];
  fix_value: string | null;
  /** "blank" or "same invalid value" */
  pattern: string;
  invalid_value: string | null;
}

export interface LearnedProposal {
  id: string;
  module: string;
  /** null and invalid_value come from stewards' fixes (step 9); the others from the data. */
  kind: "dependency" | "value_set" | "format" | "range" | "null" | "invalid_value";
  /** data or fixes; absent on a server from before step 9. */
  source?: "data" | "fixes" | null;
  evidence?: FixEvidence | null;
  table_name: string;
  determinant: string | null;
  field: string;
  confidence: number;
  support_rows: number;
  violations: number;
  sample_keys: string[];
  status: "pending" | "approved" | "rejected";
}

export async function getLearnedFor(module: string): Promise<LearnedProposal[]> {
  const res = await v2Get<{ items: LearnedProposal[] }>("/learned-rules", { status: "pending", module });
  return res.items;
}

export function approveLearned(id: string, severity: "critical" | "high" | "medium" | "low"): Promise<{ id: string; status: string; rule_id: string }> {
  return v2Post(`/learned-rules/${encodeURIComponent(id)}/approve`, { severity });
}

export function rejectLearned(id: string): Promise<{ id: string; status: string }> {
  return v2Post(`/learned-rules/${encodeURIComponent(id)}/reject`, {});
}

/** POST /learned-rules/mine without a version: mine the values stewards entered now (manage_rules). */
export function mineFixes(): Promise<{ source: "fixes"; min_records: number; edits: number; proposed: number; refreshed: number }> {
  return v2Post("/learned-rules/mine", { source: "fixes" });
}

export interface RuleDraft {
  id: string;
  /** dq_rule:<module> */
  domain: string;
  proposed_rule: { id?: string; message?: string; severity?: string; dimension?: string; field?: string; check_class?: string } & Record<string, unknown>;
  rationale: string | null;
  status: string;
  created_at: string | null;
}

export async function getDraftsFor(module: string): Promise<RuleDraft[]> {
  const res = await v2Get<{ items: RuleDraft[] }>("/rule-authoring/drafts", { module });
  return res.items;
}

export type DraftDryRun = { version_id: string; evaluated: true; hits: number; population: number; pass_rate: number } | { version_id: string; evaluated: false; reason: string };

/** The draft's own JSON is valid YAML, so it goes to the dry run as the rule text. */
export function dryRunDraft(draft: RuleDraft): Promise<DraftDryRun> {
  return v2Post("/rule-authoring/dry-run", { module: draft.domain.replace(/^dq_rule:/, ""), rule_yaml: JSON.stringify(draft.proposed_rule) });
}

export function publishDraft(id: string): Promise<{ id: string; name: string; module: string; severity: string; enabled: boolean; draft_id: string }> {
  return v2Send("POST", `/rule-authoring/drafts/${encodeURIComponent(id)}/publish`);
}

/* ---- rule actions: suppress, hand off ---- */

export function suppressRule(checkId: string, reason: string, expiresAt: string): Promise<{ id: string; check_id: string; expires_at: string }> {
  return v2Post("/rule-suppressions", { check_id: checkId, reason, expires_at: expiresAt });
}

export interface Steward {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export function getStewards(): Promise<Steward[]> {
  return v2Get<Steward[]>("/stewardship/handoff/stewards");
}

export function handOffRule(body: { check_id: string; module: string; assignee_id: string; note: string; due_date: string; version_id?: string }): Promise<{ task_id: string; exception_id: string; assigned_to: string; due_at: string }> {
  return v2Post("/stewardship/handoff", body);
}

/** The dimension key a stored dimension string means, or null. */
export function dimensionKey(value: string | null | undefined): DimensionKey | null {
  const k = (value ?? "").toLowerCase();
  return (["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const).find((d) => d === k) ?? null;
}
