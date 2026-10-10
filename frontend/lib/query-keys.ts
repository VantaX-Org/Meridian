/**
 * Drops `undefined` values and sorts keys, so two filter objects that are
 * semantically the same (different key order, or an explicit `undefined`
 * vs. an omitted key) produce the same query key and share one cache entry.
 */
function normalizeFilters(filters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Typed React Query keys, one factory per entity (spec section 9.1).
 * Every key's first element is the entity-prefix string the job stream's
 * `touches` field names; `hooks/use-jobs.ts` invalidates by matching it.
 */
export const queryKeys = {
  object: (id: string, run: string) => ["object", id, run] as const,
  objects: (run: string) => ["object", "list", run] as const,
  record: (object: string, key: string, run: string) => ["object", object, "record", key, run] as const,
  rule: (id: string, run: string) => ["rule", id, run] as const,
  records: (object: string, filters: Record<string, unknown>) =>
    ["records", object, normalizeFilters(filters)] as const,
  run: (id: string) => ["run", id] as const,
  runCompare: (a: string, b: string) => ["run", a, "vs", b] as const,
  batch: (id: string) => ["batch", id] as const,
  remediationBatches: () => ["remediation", "batches"] as const,
  remediationBatch: (id: string) => ["remediation", "batch", id] as const,
  remediationEvents: (id: string) => ["remediation", "events", id] as const,
  remediationMonitor: () => ["remediation", "monitor"] as const,
  inbox: (filters: Record<string, unknown>) => ["inbox", normalizeFilters(filters)] as const,
  systems: () => ["systems"] as const,
  migrationWaves: () => ["migration", "waves"] as const,
  migrationCockpit: (waveId: string) => ["migration", "cockpit", waveId] as const,
  migrationGaps: (runId: string, filter: Record<string, unknown>) =>
    ["migration", "gaps", runId, normalizeFilters(filter)] as const,
  migrationDryRun: (runId: string, filter: Record<string, unknown>) =>
    ["migration", "dry-run", runId, normalizeFilters(filter)] as const,
  migrationRun: (runId: string) => ["migration", "run", runId] as const,
  migrationFieldMap: (module: string, destType: string) => ["migration", "field-map", module, destType] as const,
  migrationValueMap: (module: string) => ["migration", "value-map", module] as const,
  s4Readiness: (versionId: string) => ["s4-readiness", versionId] as const,
  shellCounts: () => ["shell-counts"] as const,
  insights: (kind: "readiness" | "impact" | "owners" | "duplicates" | "exec", run?: string) =>
    run === undefined ? (["insights", kind] as const) : (["insights", kind, run] as const),
  mergeExplain: (recordId: string) => ["merge-explain", recordId] as const,
  triageMetrics: (weeks: number) => ["inbox", "triage-metrics", weeks] as const,
  stewardshipMetrics: () => ["inbox", "stewardship-metrics"] as const,
  exceptionMetrics: () => ["inbox", "exception-metrics"] as const,
  exceptionRules: () => ["inbox", "exception-rules"] as const,
  unreadNotifications: () => ["inbox", "unread-notifications"] as const,
  users: () => ["users"] as const,
  glossary: (scope: string, filters: Record<string, unknown>) =>
    ["glossary", scope, normalizeFilters(filters)] as const,
  glossaryTerm: (id: string) => ["glossary", id] as const,
  masterRecords: (filters: Record<string, unknown>) =>
    ["master-records", normalizeFilters(filters)] as const,
  masterRecord: (id: string) => ["master-records", id] as const,
  masterRecordHistory: (id: string) => ["master-records", id, "history"] as const,
  relationships: (filters: Record<string, unknown>) =>
    ["relationships", normalizeFilters(filters)] as const,
  matchRules: (domain?: string) => ["match-rules", domain ?? ""] as const,
  pairConstraints: (filters: Record<string, unknown>) =>
    ["pair-constraints", normalizeFilters(filters)] as const,
  businessProcess: (versionId?: string, module?: string) =>
    ["business-process", versionId ?? "", module ?? ""] as const,
  configImpact: (versionId?: string) => ["config-impact", versionId ?? ""] as const,
  configAwareScore: (versionId?: string, systemId?: string) =>
    ["config-aware-score", versionId ?? "", systemId ?? ""] as const,
  processMiningGraph: (versionId?: string, module?: string | null) =>
    ["process-mining-graph", versionId ?? "", module ?? ""] as const,
  processModels: () => ["process-models"] as const,
  processModel: (id: string, version?: string) => ["process-model", id, version ?? ""] as const,
  processModelVersions: (id: string) => ["process-model-versions", id] as const,
  processOverlay: (id: string, versionId?: string) =>
    ["process-overlay", id, versionId ?? ""] as const,
  processVariants: (versionId?: string) => ["process-variants", versionId ?? ""] as const,
  lineageModel: () => ["lineage-model"] as const,
  lineageImpact: (versionId?: string) => ["lineage-impact", versionId ?? ""] as const,
  lineageGraph: (node: string, direction: string, depth: number) => ["lineage-graph", node, direction, depth] as const,
  lineageGuards: (node: string, versionId?: string) => ["lineage-guards", node, versionId ?? ""] as const,
  lineageBlast: (versionId: string, checkId: string) => ["lineage-blast", versionId, checkId] as const,
  miningSummary: (days: number) => ["mining-summary", days] as const,
  miningPatterns: (filters: Record<string, unknown>) =>
    ["mining-patterns", normalizeFilters(filters)] as const,
  systemVersions: (systemId: string) => ["system-versions", systemId] as const,
  systemTrends: (systemId: string) => ["system-trends", systemId] as const,
  versionProfile: (systemId: string, versionId: string, object?: string) =>
    ["version-profile", systemId, versionId, object ?? ""] as const,
  pdReference: () => ["pd-reference"] as const,
  analyticsPredictive: () => ["analytics-predictive"] as const,
  matchRulesAll: () => ["match-rules"] as const,
  pairConstraintsAll: () => ["pair-constraints"] as const,
  processReference: () => ["process-reference"] as const,
  processModelAll: () => ["process-model"] as const,
  processModelVersionsAll: () => ["process-model-versions"] as const,
  processOverlayAll: () => ["process-overlay"] as const,
  processVariantsAll: () => ["process-variants"] as const,
  // Chain B fix pass — appended, see lib/query-keys.ts's module doc.
  systemModules: (systemId: string) => ["system-modules", systemId] as const,
  systemAgg: (systemId: string, versionId: string | undefined) => ["system-agg", systemId, versionId] as const,
  design: (systemId: string) => ["design", systemId] as const,
  configLoadJobId: (systemId: string) => ["config-load-job-id", systemId] as const,
  configLoadJob: (jobId: string | null) => ["config-load-job", jobId] as const,
  configLoad: (systemId: string) => ["config-load", systemId] as const,
  configLandscape: () => ["config-landscape"] as const,
  versionsList: (filters: Record<string, unknown>) => ["versions-list", normalizeFilters(filters)] as const,
  rules: (filters: Record<string, unknown>) => ["rules", normalizeFilters(filters)] as const,
  rulesSummary: () => ["rules", "summary"] as const,
  ruleDetail: (ruleId: string) => ["rule-detail", ruleId] as const,
  ruleApplicability: (module: string, checkId: string) => ["rule-applicability", module, checkId] as const,
  authRoles: () => ["auth-roles"] as const,
  auditEntries: (limit: number) => ["audit-entries", limit] as const,
  usersAssignable: () => ["users-assignable"] as const,
  fieldMappings: () => ["field-mappings"] as const,
  llmProviders: () => ["llm-providers"] as const,
  llmConfig: () => ["llm-config"] as const,
  licenceManifest: () => ["licence-manifest"] as const,
  systemUpdateStatus: () => ["system-update-status"] as const,
  triageTeams: () => ["triage-teams"] as const,
  triageRules: () => ["triage-rules"] as const,
  triageSla: () => ["triage-sla"] as const,
  triageSettings: () => ["triage-settings"] as const,
  adminDoctor: () => ["admin-doctor"] as const,
  contracts: (filters: Record<string, unknown>) => ["contracts", normalizeFilters(filters)] as const,
  contractCompliance: (id: string) => ["contract-compliance", id] as const,
  scoringSettings: () => ["scoring-settings"] as const,
  findingsAggregate: (versionId: string) => ["findings-aggregate", versionId] as const,
  exceptionBilling: (period: string) => ["exception-billing", period] as const,
  pilotScorecard: (systemId: string) => ["pilot-scorecard", systemId] as const,
  systemObjects: (systemId: string) => ["system-objects", systemId] as const,
  referenceLists: (systemId: string) => ["reference", systemId] as const,
  syncProfiles: (systemId: string) => ["sync-profiles", systemId] as const,
  designTables: (systemId: string, filters: Record<string, unknown>) => ["design-tables", systemId, normalizeFilters(filters)] as const,
  designTable: (systemId: string, table: string | null) => ["design-table", systemId, table] as const,
  designConfig: (systemId: string, table: string) => ["design-config", systemId, table] as const,
  designConfigDeviation: (systemId: string) => ["design-config-deviation", systemId] as const,
  designCoverage: (systemId: string) => ["design-coverage", systemId] as const,
  designSnapshots: (systemId: string) => ["design-snapshots", systemId] as const,
  designDiff: (systemId: string, a: string, b: string) => ["design-diff", systemId, a, b] as const,
  alertChannels: () => ["alert-channels"] as const,
};

/** The entity-prefix strings a job's `touches` array may contain. */
export type TouchedEntity =
  | "object"
  | "rule"
  | "records"
  | "run"
  | "batch"
  | "inbox"
  | "systems"
  | "shell-counts"
  | "insights"
  | "users"
  | "system-versions"
  | "system-modules"
  | "system-agg"
  | "design"
  | "config-load-job-id"
  | "config-load-job"
  | "config-load"
  | "versions-list"
  | "rules"
  | "rule-detail"
  | "auth-roles"
  | "audit-entries"
  | "users-assignable"
  | "field-mappings"
  | "llm-providers"
  | "llm-config"
  | "licence-manifest"
  | "system-update-status"
  | "triage-teams"
  | "triage-rules"
  | "triage-sla"
  | "triage-settings"
  | "admin-doctor"
  | "contracts"
  | "contract-compliance"
  | "scoring-settings"
  | "findings-aggregate"
  | "exception-billing"
  | "pilot-scorecard"
  | "system-objects"
  | "reference"
  | "sync-profiles"
  | "design-tables"
  | "design-table"
  | "design-config"
  | "design-config-deviation"
  | "design-coverage"
  | "design-snapshots"
  | "design-diff";
