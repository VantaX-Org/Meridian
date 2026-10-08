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
  rule: (id: string, run: string) => ["rule", id, run] as const,
  records: (object: string, filters: Record<string, unknown>) =>
    ["records", object, normalizeFilters(filters)] as const,
  run: (id: string) => ["run", id] as const,
  batch: (id: string) => ["batch", id] as const,
  inbox: (filters: Record<string, unknown>) => ["inbox", normalizeFilters(filters)] as const,
  systems: () => ["systems"] as const,
  shellCounts: () => ["shell-counts"] as const,
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
  | "shell-counts";
