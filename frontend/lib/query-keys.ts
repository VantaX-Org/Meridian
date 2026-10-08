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
  versionProfile: (systemId: string, versionId: string, object?: string) =>
    ["version-profile", systemId, versionId, object ?? ""] as const,
  pdReference: () => ["pd-reference"] as const,
  analyticsPredictive: () => ["analytics-predictive"] as const,
  matchRulesAll: () => ["match-rules"] as const,
  pairConstraintsAll: () => ["pair-constraints"] as const,
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
  | "insights";
