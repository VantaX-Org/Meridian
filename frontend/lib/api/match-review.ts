/** The match review queue: scored pairs a steward has not decided, by score band (api/routes/merge_explain.py). */
import apiClient from "./client";
import type { MatchExplanation, PairConstraintKind, UnmergeResult } from "./merge-explain";

/** auto_merge: at or above the auto-merge score; review: between the review floor and it; low: below the floor. */
export type ScoreBand = "auto_merge" | "review" | "low";

export interface ReviewPair {
  id: string;
  domain: string;
  a: string;
  b: string;
  total: number;
  band: ScoreBand;
  auto_action: string;
  steward_decision: "accept" | "reject" | null;
  constraint: PairConstraintKind | null;
  explanation: MatchExplanation | null;
  field_scores: Record<string, unknown>;
  a_record_id: string | null;
  b_record_id: string | null;
  same_cluster: boolean;
}

export interface ReviewPairList {
  pairs: ReviewPair[];
  total: number;
  bands: Record<ScoreBand, number>;
  thresholds: { auto_merge: number; review_floor: number };
}

export interface PairSide {
  key: string;
  record_id: string | null;
  confidence: number | null;
  fields: Record<string, unknown>;
}

export interface ReviewPairDetail extends ReviewPair {
  record_a: PairSide;
  record_b: PairSide;
  default_survivor: string;
}

export interface PairMergeResult {
  match_score_id: string;
  survivor_key: string;
  merged_key: string;
  golden_record_id: string;
  golden_fields: Record<string, unknown>;
  survivorship: Record<string, { value: string; winner_key: string | null; rule: string }>;
  filled_fields: string[];
  event_id: string | null;
  dry_run: boolean;
}

export interface BulkMergeResult {
  considered: number;
  merged: number;
  already_together: number;
  blocked: number;
  missing_record: number;
}

/** `record` keeps one record's pairs: either side's SAP key, whole or as the bare value of its first part. */
export async function getReviewPairs(params: {
  domain?: string; band?: ScoreBand; min_score?: number; max_score?: number; record?: string; limit?: number; offset?: number;
} = {}): Promise<ReviewPairList> {
  const { data } = await apiClient.get<ReviewPairList>("/api/v1/match-scores", { params });
  return data;
}

export async function getReviewPair(id: string): Promise<ReviewPairDetail> {
  const { data } = await apiClient.get<ReviewPairDetail>(`/api/v1/match-scores/${id}`);
  return data;
}

/** Merge one pair. `overrides` are the fields the steward picked a value for; `dry_run` previews without saving. */
export async function mergePair(id: string, body: {
  survivor?: string; overrides?: Record<string, string>; reason?: string; dry_run?: boolean;
}): Promise<PairMergeResult> {
  const { data } = await apiClient.post<PairMergeResult>(`/api/v1/match-scores/${id}/merge`, body);
  return data;
}

export async function bulkMergePairs(body: {
  min_score: number; reason: string; domain?: string; limit?: number;
}): Promise<BulkMergeResult> {
  const { data } = await apiClient.post<BulkMergeResult>("/api/v1/match-scores/bulk-merge", body);
  return data;
}

/** What splitting `keys` out of a golden record would leave, without saving anything. */
export async function previewUnmerge(id: string, keys: string[], reason: string): Promise<UnmergeResult & { dry_run: true }> {
  const { data } = await apiClient.post<UnmergeResult & { dry_run: true }>(
    `/api/v1/master-records/${id}/unmerge`, { keys, reason, dry_run: true });
  return data;
}
