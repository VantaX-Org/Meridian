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
  inbox: (filters: Record<string, unknown>) => ["inbox", normalizeFilters(filters)] as const,
  systems: () => ["systems"] as const,
  shellCounts: () => ["shell-counts"] as const,
  insights: (kind: "readiness" | "impact" | "owners" | "duplicates" | "exec", run?: string) =>
    run === undefined ? (["insights", kind] as const) : (["insights", kind, run] as const),
  mergeExplain: (recordId: string) => ["merge-explain", recordId] as const,
  // Chain B fix pass — appended, see lib/query-keys.ts's module doc.
  systemVersions: (systemId: string) => ["system-versions", systemId] as const,
  systemModules: (systemId: string) => ["system-modules", systemId] as const,
  systemAgg: (systemId: string, versionId: string | undefined) => ["system-agg", systemId, versionId] as const,
  design: (systemId: string) => ["design", systemId] as const,
  configLoadJobId: (systemId: string) => ["config-load-job-id", systemId] as const,
  configLoadJob: (jobId: string | null) => ["config-load-job", jobId] as const,
  configLoad: (systemId: string) => ["config-load", systemId] as const,
  versionsList: (filters: Record<string, unknown>) => ["versions-list", normalizeFilters(filters)] as const,
  rules: (filters: Record<string, unknown>) => ["rules", normalizeFilters(filters)] as const,
  rulesSummary: () => ["rules", "summary"] as const,
  ruleDetail: (ruleId: string) => ["rule-detail", ruleId] as const,
  users: () => ["users"] as const,
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
  | "users"
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
  | "exception-billing";
