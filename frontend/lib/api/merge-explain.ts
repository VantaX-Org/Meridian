import apiClient from "./client";

export type PairConstraintKind = "do_not_match" | "always_match";
export type MatchBand = "auto_merge" | "steward_review" | "auto_dismiss";

export interface AttributeExplanation {
  field: string;
  comparator: string;
  value_a: string;
  value_b: string;
  masked?: boolean;
  similarity: number | null;
  weight: number;
  contribution: number;
  threshold: number | null;
  threshold_met?: boolean;
  skipped: boolean;
  reason?: string;
}

export interface MatchExplanation {
  attributes: AttributeExplanation[];
  total: number;
  weight_total: number;
  band: MatchBand;
  auto_action: string;
  fired: string;
  rules_met: string[];
  rules_failed: string[];
  thresholds?: { auto_merge: number; review_floor: number };
  constraint?: PairConstraintKind | null;
}

export interface PairExplanation {
  id: string;
  a: string;
  b: string;
  total: number;
  auto_action: string;
  steward_decision: "accept" | "reject" | null;
  steward_reason: string | null;
  constraint: PairConstraintKind | null;
  explanation: MatchExplanation | null;
  field_scores: Record<string, unknown>;
}

export interface SurvivorshipLoser {
  key: string;
  value: string;
  reason: string;
}

export interface AttributeSurvivorship {
  value: string;
  winner_key: string | null;
  rule: string;
  losers: SurvivorshipLoser[];
}

export interface ExplainResponse {
  golden_record_id: string;
  key: string;
  domain: string;
  members: string[];
  golden_fields: Record<string, unknown>;
  steward_overrides: Record<string, string>;
  survivorship: Record<string, AttributeSurvivorship>;
  pairs: PairExplanation[];
  thresholds: { auto_merge: number; review_floor: number };
}

export interface ClusterNode {
  key: string;
  degree: number;
  is_survivor: boolean;
}

export interface ClusterEdge {
  id: string | null;
  source: string;
  target: string;
  total: number | null;
  linked: boolean;
  constraint: PairConstraintKind | null;
  steward_decision: "accept" | "reject" | null;
  explanation: MatchExplanation | null;
}

export interface WeakChain {
  a: string;
  via: string;
  b: string;
  reason: "no_direct_score" | "direct_score_below_threshold" | "do_not_match";
}

export interface ClusterGraph {
  golden_record_id: string;
  nodes: ClusterNode[];
  edges: ClusterEdge[];
  weak_chains: WeakChain[];
  auto_merge: number;
}

export type MergeEventType =
  | "merge" | "unmerge" | "undo" | "remerge" | "override" | "pair_accept" | "pair_reject" | "pair_clear";

export interface MergeEvent {
  id: string;
  event_type: MergeEventType;
  member_keys: string[];
  actor: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reverses_event_id: string | null;
  reversed: boolean;
  created_at: string;
}

export interface PairConstraint {
  id: string;
  domain: string;
  key_lo: string;
  key_hi: string;
  kind: PairConstraintKind;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UnmergeResult {
  golden_record_id: string;
  event_id: string;
  split_keys: string[];
  remaining_keys: string[];
  do_not_match_pairs: number;
  golden_fields: Record<string, unknown>;
}

export interface RevertResult {
  golden_record_id: string;
  event_ids: string[];
  remerged_keys: string[];
  constraints_removed: number;
  golden_fields: Record<string, unknown>;
}

export interface OverrideResult {
  golden_record_id: string;
  event_id: string;
  golden_fields: Record<string, unknown>;
  steward_overrides: Record<string, string>;
}

export interface PairDecisionResult {
  match_score_id: string;
  constraint_id: string;
  kind: PairConstraintKind;
  event_id: string;
}

export interface DryRunRequest {
  domain: string;
  weights?: Record<string, number>;
  auto_merge?: number;
  review_floor?: number;
}

export interface DryRunResult {
  domain: string;
  pairs: number;
  pairs_newly_linked: number;
  pairs_unlinked: number;
  band_moves: Record<string, number>;
  clusters_before: number;
  clusters_after: number;
  clusters_that_would_merge: number;
  clusters_that_would_split: number;
  applied: false;
}

const base = (id: string) => `/api/v1/master-records/${id}`;

export async function getMergeExplanation(id: string): Promise<ExplainResponse> {
  const { data } = await apiClient.get<ExplainResponse>(`${base(id)}/explain`);
  return data;
}

export async function getClusterGraph(id: string): Promise<ClusterGraph> {
  const { data } = await apiClient.get<ClusterGraph>(`${base(id)}/cluster-graph`);
  return data;
}

export async function getMergeEvents(id: string): Promise<MergeEvent[]> {
  const { data } = await apiClient.get<MergeEvent[]>(`${base(id)}/merge-events`);
  return data;
}

export async function unmergeRecords(id: string, keys: string[], reason: string): Promise<UnmergeResult> {
  const { data } = await apiClient.post<UnmergeResult>(`${base(id)}/unmerge`, { keys, reason });
  return data;
}

export async function undoLastMerge(id: string, reason?: string): Promise<UnmergeResult> {
  const { data } = await apiClient.post<UnmergeResult>(`${base(id)}/undo-last-merge`, { reason });
  return data;
}

export async function setStewardOverrides(
  id: string, overrides: Record<string, string | null>, reason?: string,
): Promise<OverrideResult> {
  const { data } = await apiClient.post<OverrideResult>(`${base(id)}/overrides`, { overrides, reason });
  return data;
}

export async function revertMergeEvent(eventId: string, reason?: string): Promise<RevertResult> {
  const { data } = await apiClient.post<RevertResult>(`/api/v1/merge-events/${eventId}/revert`, { reason });
  return data;
}

export async function decidePair(
  matchScoreId: string, decision: "accept" | "reject", reason: string,
): Promise<PairDecisionResult> {
  const { data } = await apiClient.post<PairDecisionResult>(
    `/api/v1/match-scores/${matchScoreId}/decision`, { decision, reason });
  return data;
}

export async function getPairConstraints(params?: {
  domain?: string; kind?: PairConstraintKind; key?: string; limit?: number;
}): Promise<PairConstraint[]> {
  const { data } = await apiClient.get<PairConstraint[]>("/api/v1/pair-constraints", { params });
  return data;
}

export async function clearPairConstraint(id: string, reason?: string): Promise<{ constraint_id: string; event_id: string }> {
  const { data } = await apiClient.delete<{ constraint_id: string; event_id: string }>(
    `/api/v1/pair-constraints/${id}`, { params: { reason } });
  return data;
}

export async function matchTuningDryRun(body: DryRunRequest): Promise<DryRunResult> {
  const { data } = await apiClient.post<DryRunResult>("/api/v1/match-tuning/dry-run", body);
  return data;
}
