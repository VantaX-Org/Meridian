/* ─── Dimension scores ─── */
export interface DimensionScores {
  completeness: number;
  accuracy: number;
  consistency: number;
  timeliness: number;
  uniqueness: number;
  validity: number;
}

/* ─── Per-module DQS summary ─── */
export interface DQSSummary {
  composite_score: number;
  dimension_scores: DimensionScores;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  total_checks: number;
  passing_checks: number;
  capped: boolean;
  cap_reason: string | null;
}

/* ─── Analysis version ─── */
export interface Version {
  id: string;
  run_at: string;
  label: string | null;
  status:
    | "pending"
    | "running"
    | "complete"
    | "failed"
    | "agents_enqueued"
    | "agents_running"
    | "agents_complete"
    | "agents_failed"
    | "ai_enriching"
    | "ai_enriched";
  dqs_summary: Record<string, DQSSummary> | null;
  metadata: {
    modules: string[];
    file_name: string;
    row_count: number;
    columns?: string[];
    parquet_path?: string;
    system_id?: string;
    baseline?: boolean;
    /** "extraction" when the run was read from a system. */
    source?: string;
    /** Records downloaded per object (system downloads). */
    object_rows?: Record<string, number>;
  } | null;
}

export interface VersionList {
  versions: Version[];
}

/* ─── Version comparison ─── */
export interface ModuleDelta {
  dqs_change: number;
  v1_score: number;
  v2_score: number;
  /** change is null when the dimension was not scored in one of the versions. */
  dimensions: Record<string, { v1: number | null; v2: number | null; change: number | null }>;
}

/** A check that ran cleanly in both versions and failed in only one of them. */
export interface CheckChange {
  check_id: string;
  module: string;
  severity: string;
  v1_affected: number;
  v2_affected: number;
}

export interface VersionComparison {
  v1: Version;
  v2: Version;
  delta: Record<string, ModuleDelta>;
  checks: { newly_failing: CheckChange[]; fixed: CheckChange[] };
}

/* ─── Finding ─── */
export type Severity = "critical" | "high" | "medium" | "low" | "warning";
export type Dimension =
  | "completeness"
  | "accuracy"
  | "consistency"
  | "timeliness"
  | "uniqueness"
  | "validity";

export interface RuleContext {
  why_it_matters: string;
  rule_authority:
    | "sap_hard_constraint"
    | "s4hana_migration"
    | "best_practice"
    | "customer_configured";
  sap_impact: string;
  valid_values_with_labels?: Record<string, string>;
}

export interface ValueFixEntry {
  invalid_value: string;
  fix_instruction: string;
  suggested_value: string | null;
  sql_statement: string | null;
}

export interface RecordFixEntry {
  record_id: string;
  id_field: string;
  invalid_value: string;
  fix_instruction: string;
  sql_statement: string | null;
}

export interface AnomalySample { record_key: string; value?: string | null }

export interface Finding {
  id: string;
  version_id: string;
  module: string;
  check_id: string;
  /** YAML rule check_class (e.g. "domain_value_check"); null for tenant custom rules. */
  check_class?: string | null;
  severity: Severity;
  dimension: Dimension;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
  details: {
    message?: string;
    sample_failing_records?: Record<string, unknown>[];
    distinct_invalid_values?: Record<string, number>;
    id_field_used?: string;
    field_checked?: string;
    /* Anomaly findings (checks/anomaly.py detect) */
    metric?: "volume" | "null_rate" | "new_values" | "vanished_values";
    table?: string;
    field?: string | null;
    expected?: { low: number | null; high: number | null; method: string; history: unknown };
    observed?: unknown;
    samples?: { good: AnomalySample[]; bad: AnomalySample[] };
    [key: string]: unknown;
  };
  /** What the finding was judged against (absent on findings stored before the tag existed). */
  baseline?: "live_config" | "sap_standard" | "s4_target";
  remediation_text: string | null;
  rule_context: RuleContext | null;
  value_fix_map: Record<string, ValueFixEntry> | null;
  record_fixes: RecordFixEntry[] | null;
  /** Cost of poor data quality (checks/cost.py) and how it was computed. */
  cost_at_risk?: number | null;
  cost_formula?: string | null;
  /** $ at risk × blocked SAP features × severity — the "impact" sort. */
  impact_score?: number | null;
  /** 'anomaly' = deviation from the system's previous extractions (checks/anomaly.py). */
  finding_type?: "rule" | "anomaly";
  created_at: string;
  /* Glossary enrichment (Phase K) */
  business_name?: string | null;
  glossary_term_id?: string | null;
  business_definition?: string | null;
}

export interface FindingReportContext {
  finding_id: string;
  check_id: string;
  module: string;
  report_context: {
    cross_finding_patterns: Array<{
      pattern_description: string;
      affected_check_ids: string[];
      shared_record_count: number;
      recommended_approach: string;
    }>;
    effort_estimate: {
      check_id: string;
      affected_count: number;
      fix_complexity: string;
      estimated_person_hours: number;
      estimation_basis: string;
    } | null;
    fix_sequence: {
      sequence: number;
      check_id: string;
      reason: string;
    } | null;
    flags: Array<{ check_id: string; flag: string }>;
    executive_summary: string | null;
  } | null;
}

export interface FindingList {
  findings: Finding[];
  total: number;
  filters_applied: Record<string, string>;
}

/* ─── Upload ─── */
export interface UploadResponse {
  version_id: string;
  job_id: string;
  status: string;
}

/* ─── Health ─── */
export interface LicenceStatus {
  valid: boolean | null;
  modules?: string[];
  expires_at?: string | null;
  days_remaining?: number | null;
  last_checked?: string | null;
  status?: string;
  reason?: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  llm_provider: string;
  llm_connected: boolean;
  licence: LicenceStatus;
  timestamp: string;
}

/* ─── Report ─── */
export interface ReportModule {
  name: string;
  dqs_score: number;
  readiness_status: "go" | "conditional" | "no-go";
  critical_count: number;
  root_causes?: unknown[];
  remediations?: unknown[];
  blockers?: string[];
  conditions?: string[];
}

export interface ReportJson {
  executive_summary: string;
  overall_dqs: { composite: number; by_module?: Record<string, number> };
  findings_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  migration_readiness: {
    overall_status: "go" | "conditional" | "no-go";
    overall_score: number;
    summary: string;
  };
  modules: ReportModule[];
}

/* ─── Settings ─── */
/** Assumptions behind the prescriptive planner's effort and value figures. */
export interface PlannerConfig {
  minutes_per_record: number;
  investigation_hours: number;
  cleaning_item_hours: number;
  exception_hours: number;
  sprint_hours: number;
  cost_per_record: number | null;
  currency: string;
}

export interface AlertThresholds {
  critical_threshold: number;
  high_threshold: number;
  dqs_drop_threshold: number;
  /** module → minimum DQS; a run scoring the module below it raises an alert */
  module_floors?: Record<string, number>;
  /** Go/At-risk/No-go DQS cutoff for the readiness grid (spec 8.1) */
  readiness_dqs_threshold: number;
  /** wave name → the migration-engine module names it covers (spec 8.1) */
  readiness_waves: Record<string, string[]>;
}

/** Cost model used to price findings and features (spec 8.2's value-at-risk). */
export interface CostModel {
  currency: string;
  severity: Record<string, number>;
  modules: Record<string, number>;
  rules: Record<string, number>;
  /** feature name (e.g. "MIGO") → value per blocked record */
  features: Record<string, number>;
}

export interface TenantSettings {
  name: string;
  licensed_modules: string[];
  planner_config: PlannerConfig | null;
  dqs_weights: DimensionScores | null;
  alert_thresholds: AlertThresholds | null;
  notification_config: {
    email: string;
    teams_webhook: string;
    daily_digest: boolean;
    weekly_summary: boolean;
    monthly_report: boolean;
  } | null;
  stripe_customer_id: string | null;
}

/* ─── Exceptions ─── */

export type ExceptionType =
  | "sap_transaction"
  | "dq_rule"
  | "custom_business"
  | "anomaly"
  | "contract_violation";

export type ExceptionStatus =
  | "open"
  | "investigating"
  | "pending_approval"
  | "resolved"
  | "verified"
  | "closed";

export interface Exception {
  id: string;
  tenant_id: string;
  type: ExceptionType;
  category: string;
  severity: Severity;
  status: ExceptionStatus;
  title: string;
  description: string;
  source_system: string | null;
  source_reference: string | null;
  affected_records: Record<string, unknown> | null;
  estimated_impact_zar: number | null;
  assigned_to: string | null;
  escalation_tier: number;
  sla_deadline: string | null;
  root_cause_category: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  linked_finding_id: string | null;
  linked_cleaning_id: string | null;
  linked_finding?: Record<string, unknown> | null;
  linked_cleaning?: Record<string, unknown> | null;
  billing_tier: number | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  comments?: ExceptionComment[];
}

export interface ExceptionComment {
  id: string;
  exception_id: string;
  user_id: string | null;
  user_name: string;
  text: string;
  created_at: string;
}

export interface ExceptionRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  rule_type: string;
  object_type: string;
  condition: string;
  severity: Severity;
  auto_assign_to: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ExceptionMetrics {
  open_count: number;
  resolved_count: number;
  avg_resolution_hours: number;
  sla_compliance_pct: number;
  overdue_count: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface ExceptionBilling {
  period: string;
  tier1_count: number;
  tier2_count: number;
  tier3_count: number;
  tier4_count: number;
  tier1_amount: number;
  tier2_amount: number;
  tier3_amount: number;
  tier4_amount: number;
  base_fee: number;
  total_amount: number;
  stripe_invoice_id: string | null;
}

export interface ExceptionListResponse {
  exceptions: Exception[];
  total: number;
  page: number;
  per_page: number;
}

/* ─── Lineage ─── */

export interface LineageNode {
  id: string;
  label: string;
  type: "record" | "finding" | "exception" | "cleaning" | "dedup" | "relationship";
  data: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  label: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/* ─── Contracts ─── */

export type ContractStatus = "draft" | "pending_approval" | "active" | "expired";

export interface Contract {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  producer: string;
  consumer: string;
  schema_contract: Record<string, unknown> | null;
  quality_contract: Record<string, number> | null;
  freshness_contract: Record<string, unknown> | null;
  volume_contract: Record<string, unknown> | null;
  status: ContractStatus;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  latest_compliant?: boolean | null;
  last_checked?: string | null;
}

export interface ContractListResponse {
  contracts: Contract[];
  total: number;
}

export interface ComplianceRecord {
  id: string;
  contract_id: string;
  version_id: string | null;
  completeness_actual: number | null;
  accuracy_actual: number | null;
  consistency_actual: number | null;
  timeliness_actual: number | null;
  uniqueness_actual: number | null;
  validity_actual: number | null;
  overall_compliant: boolean;
  violations:
    | Array<{
        dimension: string;
        threshold: number;
        actual: number;
        gap: number;
      }>
    | {
        type: string;
        object_key: string;
        field_violations: { field: string; reason: string }[];
      }
    | null;
  recorded_at: string;
}

export interface ComplianceHistoryResponse {
  contract_id: string;
  compliance_history: ComplianceRecord[];
}

/* ─── Notifications ─── */

export type NotificationType =
  | "finding"
  | "cleaning"
  | "exception"
  | "approval"
  | "digest"
  | "warning";

export interface Notification {
  id: string;
  tenant_id: string;
  user_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
}

export interface UnreadCountResponse {
  count: number;
}

/* ─── Users / RBAC ─── */

export type UserRole =
  | "admin"
  | "manager"
  | "steward"
  | "analyst"
  | "approver"
  | "auditor"
  | "viewer"
  | "ai_reviewer";

export interface User {
  id: string;
  tenant_id: string;
  clerk_user_id: string | null;
  email: string;
  name: string;
  role: UserRole;
  permissions: Record<string, unknown> | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface UserListResponse {
  users: User[];
}

/* ─── SAP Systems / Sync ─── */

export interface SAPSystem {
  id: string;
  name: string;
  system_type: SystemType;
  host: string | null;
  client: string | null;
  sysnr: string | null;
  username: string | null;
  base_url: string | null;
  company_id: string | null;
  auth_type: AuthType | null;
  description: string | null;
  environment: "PRD" | "QAS" | "DEV";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export interface SAPSystemListResponse {
  systems: SAPSystem[];
}

export interface TestConnectionResponse {
  connected: boolean;
  message: string;
}

export interface SyncProfile {
  id: string;
  system_id: string;
  domain: string;
  tables: string[];
  schedule_cron: string | null;
  active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  /** "delta" re-reads only what SAP's change documents say changed since the last download. */
  extraction_mode: "full" | "delta";
}

/* ─── Golden Records / MDM ─── */

export type MasterRecordStatus =
  | "candidate"
  | "pending_review"
  | "golden"
  | "superseded";

export interface SourceContribution {
  value: unknown;
  source_system: string;
  extracted_at: string;
  confidence: number;
  ai_recommendation?: string;
  ai_confidence?: number;
  ai_reasoning?: string;
}

export interface MasterRecordSummary {
  id: string;
  domain: string;
  sap_object_key: string;
  overall_confidence: number;
  status: MasterRecordStatus;
  source_count: number;
  pending_issues: number;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterRecordDetail {
  id: string;
  domain: string;
  sap_object_key: string;
  golden_fields: Record<string, unknown>;
  source_contributions: Record<string, SourceContribution>;
  overall_confidence: number;
  status: MasterRecordStatus;
  promoted_at: string | null;
  promoted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterRecordListResponse {
  records: MasterRecordSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface MasterRecordHistoryEntry {
  id: string;
  changed_at: string;
  changed_by: string | null;
  change_type: string;
  previous_fields: Record<string, unknown> | null;
  new_fields: Record<string, unknown> | null;
  ai_was_involved: boolean;
  ai_recommendation_accepted: boolean | null;
}

export interface SyncRun {
  id: string;
  profile_id: string;
  started_at: string;
  completed_at: string | null;
  rows_extracted: number;
  findings_delta: number;
  golden_records_updated: number;
  status: "running" | "completed" | "failed";
  error_detail: string | null;
  ai_quality_score: number | null;
  anomaly_flags: Array<{
    type: string;
    detail: string;
    severity?: string;
    column?: string;
  }> | null;
}

/* ─── Match & Merge Engine ─── */

export type MatchType = "exact" | "fuzzy" | "phonetic" | "numeric_range" | "semantic";

export interface MatchRule {
  id: string;
  tenant_id: string;
  domain: string;
  field: string;
  match_type: MatchType;
  weight: number;
  threshold: number;
  active: boolean;
}

export interface MatchRulesListResponse {
  rules: MatchRule[];
  total: number;
}

export interface AIProposedRule {
  id: string;
  tenant_id: string;
  domain: string;
  proposed_rule: {
    field: string;
    match_type: MatchType;
    weight: number;
    threshold: number;
  };
  rationale: string;
  supporting_correction_count: number;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AIProposedRulesListResponse {
  rules: AIProposedRule[];
  total: number;
}

export interface SimulationResult {
  total_pairs: number;
  auto_merge_count: number;
  auto_dismiss_count: number;
  queue_count: number;
}

/* ─── Phase K: Business Glossary ─── */

export type GlossaryStatus = "active" | "under_review" | "deprecated";

export interface GlossaryTermSummary {
  id: string;
  sap_table: string;
  sap_field: string;
  technical_name: string;
  business_name: string;
  domain: string;
  mandatory_for_s4hana: boolean;
  status: GlossaryStatus;
  ai_drafted: boolean;
  last_reviewed_at: string | null;
  review_cycle_days: number;
  linked_rules_count: number;
}

export interface LinkedRule {
  rule_id: string;
  domain: string;
  pass_rate: number | null;
  severity: string | null;
  affected_count: number | null;
  total_count: number | null;
}

export interface GlossaryChangeEntry {
  id: string;
  changed_by: string;
  changed_at: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  change_reason: string | null;
}

export interface GlossaryTermDetail {
  id: string;
  sap_table: string;
  sap_field: string;
  technical_name: string;
  business_name: string;
  business_definition: string | null;
  why_it_matters: string | null;
  sap_impact: string | null;
  domain: string;
  approved_values: Record<string, string> | string[] | null;
  mandatory_for_s4hana: boolean;
  rule_authority: string | null;
  data_steward_id: string | null;
  review_cycle_days: number;
  last_reviewed_at: string | null;
  status: GlossaryStatus;
  ai_drafted: boolean;
  created_at: string;
  updated_at: string;
  linked_rules: LinkedRule[];
  change_history: GlossaryChangeEntry[];
}

export interface GlossaryListResponse {
  terms: GlossaryTermSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface AIDraftResponse {
  business_definition: string;
  why_it_matters_business: string;
  committed: boolean;
}

export interface BatchLookupEntry {
  business_name: string;
  id: string;
  business_definition: string | null;
}

export interface BatchLookupResponse {
  lookup: Record<string, BatchLookupEntry>;
}

/* ─── Stewardship Queue ─── */

export type StewardshipItemType =
  | "merge_decision"
  | "golden_record_review"
  | "exception"
  | "writeback_approval"
  | "contract_breach"
  | "glossary_review";

export type StewardshipStatus = "open" | "in_progress" | "resolved" | "escalated";

export interface StewardshipQueueItem {
  id: string;
  tenant_id: string;
  item_type: StewardshipItemType;
  source_id: string;
  domain: string;
  priority: number;
  due_at: string | null;
  assigned_to: string | null;
  status: StewardshipStatus;
  sla_hours: number | null;
  created_at: string;
  updated_at: string;
  ai_recommendation: string | null;
  ai_confidence: number | null;
  /** Triage / SLA fields; present once migration 059 is applied. */
  assigned_team_id?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  ack_due_at?: string | null;
  sla_state?: "on_track" | "at_risk" | "breached" | null;
  sla_paused_at?: string | null;
  snoozed_until?: string | null;
  snooze_reason?: string | null;
}

export interface StewardshipQueueListResponse {
  items: StewardshipQueueItem[];
  total: number;
}

export interface StewardshipMetrics {
  items_by_type: Record<string, number>;
  items_by_status: Record<string, number>;
  avg_resolution_hours_by_type: Record<string, number>;
  backlog_total: number;
  sla_compliance_rate: number;
  ai_acceptance_rate: number | null;
  steward_breakdown: StewardBreakdown[] | null;
}

export interface StewardBreakdown {
  steward_name: string;
  resolved: number;
  total: number;
  avg_resolution_hours: number | null;
}

/* ─── Relationships ─── */

export interface RecordRelationship {
  id: string;
  from_domain: string;
  from_key: string;
  to_domain: string;
  to_key: string;
  relationship_type: string;
  sap_link_table: string | null;
  discovered_at: string;
  active: boolean;
  ai_inferred: boolean;
  ai_confidence: number | null;
  impact_score: number | null;
}

export interface RelationshipListResponse {
  relationships: RecordRelationship[];
  total: number;
}

export interface RelationshipTypeRef {
  id: string;
  from_table: string;
  to_table: string;
  relationship_type: string;
  description: string | null;
}

/* ─── MDM Governance Metrics ─── */

export interface MdmMetric {
  snapshot_date: string;
  domain: string | null;
  golden_record_count: number;
  golden_record_coverage_pct: number;
  avg_match_confidence: number;
  steward_sla_compliance_pct: number;
  source_consistency_pct: number;
  mdm_health_score: number;
  backlog_count: number;
  sync_coverage_pct: number;
  ai_narrative: string | null;
  ai_projected_score: number | null;
  ai_risk_flags: string[] | null;
}

export interface MdmDashboardResponse {
  latest: MdmMetric | null;
  trend: MdmMetric[];
  active_systems_count: number;
}

export interface MdmHistoryResponse {
  history: MdmMetric[];
}

/* -- System Types (Extended) -- */
export type SystemType = "ecc" | "s4hana_onprem" | "s4hana_cloud" | "successfactors" | "concur" | "ariba" | "btp" | "ewm";
export type AuthType = "rfc" | "basic" | "oauth2_client_credentials" | "oauth2_saml" | "api_key";
export type HealthStatus = "healthy" | "degraded" | "unreachable" | "auth_failed" | "unknown";

export interface SAPSystemExtended {
  id: string;
  name: string;
  system_type: SystemType;
  host: string | null;
  client: string | null;
  sysnr: string | null;
  username: string | null;
  base_url: string | null;
  company_id: string | null;
  auth_type: AuthType | null;
  description: string | null;
  environment: "PRD" | "QAS" | "DEV";
  is_active: boolean;
  health_status: HealthStatus;
  health_message: string | null;
  last_health_check: string | null;
  config_last_synced_at: string | null;
  config_sync_status: string | null;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  discovery_status: string | null;
  discovered_at: string | null;
  sap_release: string | null;
  last_analysis_at: string | null;
}

export interface SystemModule {
  module: string;
  system_type: SystemType;
  enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  row_count: number;
  config_synced: boolean;
}

export interface ConfigSnapshot {
  table: string;
  data: Record<string, unknown>[];
  record_count: number;
  source: "live" | "baseline";
  synced_at: string;
}

export interface ConfigImpactResult {
  feature: string;
  system: string;
  status: "blocked" | "degraded" | "ok";
  blocking_findings: { check_id: string; affected_count: number; module: string; severity: string }[];
  total_affected_records: number;
  blocked_transactions: string[];
  opportunity_cost_summary: string;
  cross_system_dependencies: Record<string, string>;
}

export interface ConfigImpactSummary {
  total_features_assessed: number;
  features_blocked: number;
  features_degraded: number;
  features_ok: number;
  top_blocked_features: string[];
}

export interface BusinessProcessL5Field {
  field: string;
  description: string;
  mandatory: boolean;
  config_source: string;
  check_id: string | null;
  dq_status: "green" | "amber" | "red";
  pass_rate: number | null;
  affected_count: number;
  finding_message: string;
}

export interface BusinessProcessL5Activity {
  l5_id: string;
  l5_name: string;
  tcode: string;
  description: string;
  fields: BusinessProcessL5Field[];
  check_ids: string[];
  activity_status: "green" | "amber" | "red";
}

export interface BusinessProcessL4 {
  l4_id: string;
  l4_name: string;
  tcode: string;
  description: string;
  config_dependency: { table: string; field: string; source: string; values_found: number } | null;
  activities: BusinessProcessL5Activity[];
  step_status: "green" | "amber" | "red";
}

export interface BusinessProcessL3 {
  l3_id: string;
  l3_name: string;
  description: string;
  l4_subprocesses: BusinessProcessL4[];
  overall_readiness: "green" | "amber" | "red";
}

export interface BusinessProcessL2 {
  l2_id: string;
  l2_name: string;
  l3_processes: BusinessProcessL3[];
}

export interface BusinessProcessL1 {
  l1_id: string;
  l1_name: string;
  l1_description: string;
  system: string;
  l2_groups: BusinessProcessL2[];
}

// ── Migration mode ───────────────────────────────────────────────────────────

export type MigrationMode = "source_to_source" | "source_to_destination" | "s4_dry_run";
export type MigrationStatus =
  | "queued"
  | "running"
  | "analysed"
  | "exported"
  | "failed";
export type TransferVerdict = "go" | "conditional" | "no-go";

export interface MigrationRun {
  id: string;
  mode: MigrationMode;
  source_system_id: string | null;
  dest_system_id: string | null;
  source_version_id: string | null;
  /** S/4HANA standard release analysed against when no target system is connected. */
  target_release: string | null;
  target_connected: boolean;
  modules: string[];
  status: MigrationStatus;
  readiness_verdict: TransferVerdict | null;
  readiness_score: number | null;
  critical_count: number;
  records_total: number;
  records_blocked: number;
  error_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

export type WaveStage = "plan" | "mock1" | "mock2" | "dress" | "cutover";
/** Grid verdict (engine "conditional" is shown as at_risk). */
export type WaveVerdict = "go" | "at_risk" | "no_go";

export interface MigrationWave {
  id: string;
  name: string;
  source_system_id: string | null;
  target_system_id: string | null;
  target_release: string;
  modules: string[];
  target_date: string | null;
  stage: WaveStage;
  min_readiness: number;
  min_dqs: number | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  created_at: string;
  updated_at: string;
  /** List view only: the latest analysed run (engine verdict) and its recent scores. */
  last_run_id?: string | null;
  last_verdict?: TransferVerdict | null;
  last_score?: number | null;
  last_completed_at?: string | null;
  trend?: number[];
}

export interface WaveObject {
  module: string;
  label: string;
  verdict: WaveVerdict;
  score: number | null;
  records: number;
  records_blocked: number;
  blocker_count: number;
  dqs: number | null;
}

export interface WaveBlocker {
  module: string;
  label: string;
  gap_type: MigrationGapType;
  field: string | null;
  severity: Severity;
  records: number;
  gaps: number;
}

export interface WaveTrendPoint {
  run_id: string;
  completed_at: string;
  score: number;
}

export interface WaveCockpit {
  wave: MigrationWave;
  run_id: string | null;
  source_version_id: string | null;
  dest_system_type: string;
  verdict: WaveVerdict;
  score: number | null;
  records_total: number;
  records_blocked: number;
  objects: WaveObject[];
  trend: WaveTrendPoint[];
  blockers: WaveBlocker[];
}

export type MigrationGapType =
  | "unmapped_field"
  | "target_field_missing"
  | "obsolete_target"
  | "target_config_unverified"
  | "length_truncation"
  | "precision_loss"
  | "type_conversion"
  | "case_change"
  | "domain_value"
  | "check_table_value"
  | "value_unmapped"
  | "target_mandatory"
  | "key_missing"
  | "key_collision"
  | "target_key_exists";

export interface MigrationModuleSummary {
  records: number;
  blocked_records: number;
  score: number;
  verdict: TransferVerdict;
  gaps: Partial<Record<MigrationGapType, number>>;
  source_tables: string[];
}

export interface MigrationGapBreakdown {
  module: string;
  gap_type: MigrationGapType;
  severity: Severity;
  grounded: boolean;
  n: number;
  records: number;
  fields: number;
}

export interface MigrationRunDetail {
  run: MigrationRun & { gap_summary: Record<string, MigrationModuleSummary> | null };
  gap_breakdown: MigrationGapBreakdown[];
  /** Critical gaps affecting all records (target field missing/obsolete) — these block load-file export. */
  structural_critical: number;
}

export interface MigrationGapFinding {
  module: string;
  source_table: string | null;
  /** Composite source key, e.g. "LIFNR=0000100001|BUKRS=1000"; null for structural gaps. */
  record_key: string | null;
  source_field: string | null;
  source_value: string | null;
  dest_table: string | null;
  target_field: string | null;
  target_value: string | null;
  gap_type: MigrationGapType;
  severity: Severity;
  detail: string | null;
  provenance: string | null;
  /** False when the target rule is SAP-standard only (no connected target to confirm). */
  grounded: boolean;
}

export interface DdicFieldDef {
  type: string | null;
  length: number;
  decimals: number;
  check_table: string | null;
  description: string;
}

export interface TransferFieldMapping {
  id: string;
  module: string;
  /** TABLE.FIELD in the source. */
  source_field: string;
  dest_system_type: string;
  dest_table: string | null;
  dest_field: string | null;
  value_map: boolean;
  origin: string;
  transform_note: string | null;
  is_confirmed: boolean;
  source_def: DdicFieldDef | null;
  target_def: DdicFieldDef | null;
}

export interface TransferValueMapping {
  id: string;
  target_field: string;
  source_value: string;
  target_value: string;
  note: string | null;
  updated_at: string;
}
