import { v2Get, v2Send } from "./client";
import type { BulkMergeResult } from "@/lib/api/match-review";
import type { ClusterGraph, DryRunRequest, DryRunResult, OverrideResult, PairConstraint, PairConstraintKind, RevertResult, UnmergeResult } from "@/lib/api/merge-explain";
import type { SurvivorshipRule, SurvivorshipRuleInput } from "@/lib/api/survivorship";

/**
 * Fixture-aware clients for the match review, cluster and survivorship endpoints that the older axios clients
 * (merge-explain.ts, match-review.ts, survivorship.ts) own. Same routes and shapes; these go through v2Get/v2Send so
 * `?fixture=1` works. Routes: api/routes/merge_explain.py, match_scores.py, survivorship_rules.py.
 */

export type { BulkMergeResult, ClusterGraph, DryRunRequest, DryRunResult, OverrideResult, PairConstraint, PairConstraintKind, RevertResult, SurvivorshipRule, SurvivorshipRuleInput, UnmergeResult };

const gr = (id: string): string => `/master-records/${encodeURIComponent(id)}`;

/** GET /master-records/{id}/cluster-graph: the members as nodes, every scored pair as an edge, and the weak chains. */
export const getClusterGraph = (id: string) => v2Get<ClusterGraph>(`${gr(id)}/cluster-graph`);

/** GET /pair-constraints: the do-not-match and always-match decisions. */
export const getPairConstraints = (domain: string) => v2Get<PairConstraint[]>("/pair-constraints", { domain, limit: 200 });

/** DELETE /pair-constraints/{id}: forget one steward decision about a pair. */
export const clearPairConstraint = (id: string, reason?: string) =>
  v2Send<{ constraint_id: string; event_id: string }>("DELETE", `/pair-constraints/${encodeURIComponent(id)}`, undefined, { reason });

/** POST /match-tuning/dry-run: what new weights or thresholds would do, applied to nothing. */
export const matchTuningDryRun = (body: DryRunRequest) => v2Send<DryRunResult>("POST", "/match-tuning/dry-run", body);

/** POST /match-scores/bulk-merge: merge every open pair at or above a score. */
export const bulkMergePairs = (body: { min_score: number; reason: string; domain?: string; limit?: number }) =>
  v2Send<BulkMergeResult>("POST", "/match-scores/bulk-merge", body);

export const undoLastMerge = (id: string, reason?: string) => v2Send<UnmergeResult>("POST", `${gr(id)}/undo-last-merge`, { reason });

export const setStewardOverrides = (id: string, overrides: Record<string, string | null>, reason?: string) =>
  v2Send<OverrideResult>("POST", `${gr(id)}/overrides`, { overrides, reason });

export const revertMergeEvent = (eventId: string, reason?: string) =>
  v2Send<RevertResult>("POST", `/merge-events/${encodeURIComponent(eventId)}/revert`, { reason });

/** PUT /survivorship-rules: replaces the object's rule set. */
export const putSurvivorshipRulesV2 = (domain: string, rules: SurvivorshipRuleInput[]) =>
  v2Send<{ rules: SurvivorshipRule[]; total: number } | SurvivorshipRule[]>("PUT", "/survivorship-rules", { domain, rules });

export { v2Get };
