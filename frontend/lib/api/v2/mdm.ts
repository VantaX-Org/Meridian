import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";
import type { MasterRecordDetail, MasterRecordListResponse, MasterRecordSummary, GlossaryListResponse, GlossaryTermDetail, GlossaryTermSummary, BusinessProcessL1 } from "@/types/api";
import type { ReviewPairDetail, ReviewPairList, PairMergeResult } from "@/lib/api/match-review";
import type { ExplainResponse, MergeEvent, PairDecisionResult, UnmergeResult } from "@/lib/api/merge-explain";
import type { SurvivorshipRule } from "@/lib/api/survivorship";
import type { DataOwner } from "@/lib/api/owners";

/**
 * Reads and writes behind the Golden records, Glossary and Processes tabs and their inspectors. Every call is an
 * existing endpoint of the current interface (master_records.py, merge_explain.py, survivorship_rules.py, glossary.py,
 * business_process.py) with the same shapes; the types are re-used from the clients that already describe them. In
 * fixture mode the answers come from fixtures/mdm.ts.
 */

export type { MasterRecordDetail, MasterRecordListResponse, GlossaryListResponse, GlossaryTermDetail, BusinessProcessL1, ReviewPairDetail, ReviewPairList, PairMergeResult, ExplainResponse, MergeEvent, PairDecisionResult, UnmergeResult, SurvivorshipRule, DataOwner };

/**
 * A row of GET /master-records. `name` is NOT in the API's list item today (the golden name sits in golden_fields of the
 * detail); the tab shows a dash for it until the list carries it.
 */
export type GoldenRow = MasterRecordSummary & { name?: string | null };

/** A row of GET /glossary. `business_definition` is NOT in the API's list item today (only in the detail). */
export type TermRow = GlossaryTermSummary & { business_definition?: string | null };

/* ---- golden records ---- */

export const GOLDEN_PAGE = 25;

/** GET /master-records, scoped to the object's domain. */
export function getGoldenRecords(domain: string, page: number): Promise<MasterRecordListResponse> {
  return v2Get<MasterRecordListResponse>("/master-records", { domain, page, per_page: GOLDEN_PAGE });
}

export function getGoldenRecord(id: string): Promise<MasterRecordDetail> {
  return v2Get<MasterRecordDetail>(`/master-records/${encodeURIComponent(id)}`);
}

/** GET /master-records/{id}/explain: members, and for each field the surviving value, its rule and the losers. */
export function getGoldenExplain(id: string): Promise<ExplainResponse> {
  return v2Get<ExplainResponse>(`/master-records/${encodeURIComponent(id)}/explain`);
}

export function getGoldenEvents(id: string): Promise<MergeEvent[]> {
  return v2Get<MergeEvent[]>(`/master-records/${encodeURIComponent(id)}/merge-events`);
}

/** GET /match-scores: the pairs waiting for a steward in this object (band review), scored. */
export function getMatchPairs(domain: string, limit: number, offset = 0): Promise<ReviewPairList> {
  return v2Get<ReviewPairList>("/match-scores", { domain, band: "review", limit, offset });
}

/** A record of a cross-system cluster: its SAP key, the connected system it sits in and its description. */
export interface CrossMember {
  key: string;
  system_id: string | null;
  system_name: string | null;
  text: string | null;
  golden_record_id: string | null;
}

/** GET /match-scores/across-systems: duplicates whose records sit in different connected systems, as clusters. */
export interface CrossSystemList {
  domain: string;
  pairs: number;
  by_systems: { a: string; b: string; pairs: number; open: number; merged: number }[];
  clusters: { id: string; members: CrossMember[]; pairs: number; best: number; merged: boolean; pair_ids: string[] }[];
  clusters_total: number;
}

export function getAcrossSystems(domain: string, limit = 50): Promise<CrossSystemList> {
  return v2Get<CrossSystemList>("/match-scores/across-systems", { domain, limit });
}

export function getMatchPair(id: string): Promise<ReviewPairDetail> {
  return v2Get<ReviewPairDetail>(`/match-scores/${encodeURIComponent(id)}`);
}

export async function getSurvivorship(domain: string): Promise<SurvivorshipRule[]> {
  const res = await v2Get<{ rules: SurvivorshipRule[]; total: number }>("/survivorship-rules", { domain });
  return res.rules;
}

/** Merge one pair; `overrides` are the fields where the steward picked the other record's value. */
export function mergePair(id: string, body: { survivor: string; overrides: Record<string, string>; reason: string }): Promise<PairMergeResult> {
  return v2Send<PairMergeResult>("POST", `/match-scores/${encodeURIComponent(id)}/merge`, body);
}

/** Mark a pair as not a duplicate: the pair is never offered again. */
export function markNotDuplicate(id: string, reason: string): Promise<PairDecisionResult> {
  return v2Send<PairDecisionResult>("POST", `/match-scores/${encodeURIComponent(id)}/decision`, { decision: "reject", reason });
}

/** Split records out of a golden record. */
export function splitGolden(id: string, keys: string[], reason: string): Promise<UnmergeResult> {
  return v2Send<UnmergeResult>("POST", `/master-records/${encodeURIComponent(id)}/unmerge`, { keys, reason });
}

/* ---- glossary ---- */

/** GET /glossary for the object's domain (the API pages at 200). */
export function getGlossary(domain: string, search: string): Promise<GlossaryListResponse> {
  return v2Get<GlossaryListResponse>("/glossary", { domain, search: search || undefined, per_page: 200 });
}

export function getGlossaryTermDetail(id: string): Promise<GlossaryTermDetail> {
  return v2Get<GlossaryTermDetail>(`/glossary/${encodeURIComponent(id)}`);
}

export interface TermEdit {
  business_name?: string;
  business_definition?: string;
  status?: string;
}

export function updateTerm(id: string, body: TermEdit): Promise<{ status: string; changes: number }> {
  return v2Send("PUT", `/glossary/${encodeURIComponent(id)}`, body);
}

/** Marks the term reviewed now (the owner's approval of its current wording). */
export function reviewTerm(id: string): Promise<{ status: string; term_id: string }> {
  return v2Send("POST", `/glossary/${encodeURIComponent(id)}/review`);
}

/** Drafts terms for every analysed object from the rule library. Idempotent. */
export function populateGlossary(): Promise<{ created: number; linked: number; objects: number }> {
  return v2Send("POST", "/glossary/populate");
}

/** PUT /owners: sets the owner of an object, rule or system (needs the assign permission). */
export function putOwner(kind: DataOwner["kind"], ref: string, owner_user_id: string | null, steward_user_id: string | null = null): Promise<DataOwner> {
  return v2Send("PUT", "/owners", { kind, ref, owner_user_id, steward_user_id });
}

export async function getObjectOwners(): Promise<DataOwner[]> {
  const res = await v2Get<{ owners: DataOwner[] }>("/owners", { kind: "object" });
  return res.owners;
}

/* ---- processes ---- */

export interface ProcessDocument {
  processes: BusinessProcessL1[];
  reason?: string;
}

/** GET /business-process/{run}/{module}: the L1 to L5 readiness of the processes that read the object's fields. */
export function getProcessDocument(run: string, module: string): Promise<ProcessDocument> {
  return v2Get<ProcessDocument>(`/business-process/${encodeURIComponent(run)}/${encodeURIComponent(module)}`);
}

/** POST /insights/duplicates/merge-proposals: put pairs on the stewardship queue as merge decisions, due in 48 hours unless a date is given. */
export function proposeMerges(pairs: { match_score_id: string; priority: number; due_at?: string }[]): Promise<{ created: string[] }> {
  return v2Send<{ created: string[] }>("POST", "/insights/duplicates/merge-proposals", { pairs });
}

/** POST /glossary/{id}/ai-draft (trigger_ai): a proposed wording from Aletheia. Nothing is saved; the owner reviews it first. */
export function draftTermWithAi(id: string): Promise<{ business_definition: string; why_it_matters_business: string; committed: boolean }> {
  return v2Send("POST", `/glossary/${encodeURIComponent(id)}/ai-draft`);
}

/* Match profile, weight calibration and the consolidation pack (api/routes/match_depth.py). */

export interface CalibrationField {
  field: string;
  match_type: string;
  threshold: number;
  current_weight: number;
  accepted_with_value: number;
  accepted_agree: number;
  rejected_with_value: number;
  rejected_agree: number;
  /** Share of accepted pairs where the field agrees. */
  m: number;
  /** Share of rejected pairs where the field agrees. */
  u: number;
  agreement_weight: number;
  disagreement_weight: number;
  recommended_weight: number;
}

export interface TuningPreview {
  pairs: number;
  pairs_newly_linked: number;
  pairs_unlinked: number;
  band_moves: Record<string, number>;
  clusters_before: number;
  clusters_after: number;
  clusters_that_would_merge: number;
  clusters_that_would_split: number;
  applied: boolean;
}

export interface MatchCalibration {
  domain: string;
  id_field: string;
  /** How candidate pairs are found: key = equal normalised identifier, neighbour = sorted name window, blocked = name within a group. */
  passes: { name: string; kind: string; fields: string[] }[];
  rules_stored: boolean;
  missing_profile_rules: { field: string; match_type: string; weight: number; threshold: number }[];
  status: "ready" | "insufficient";
  accepted: number;
  rejected: number;
  min_decisions: number;
  fields: CalibrationField[];
  preview: TuningPreview | null;
}

export interface CalibrationApplied {
  domain: string;
  reason: string;
  changed: { field: string; before: number; after: number }[];
  added: string[];
  accepted: number;
  rejected: number;
}

export interface ConsolidationPack {
  domain: string;
  merged: number;
  survivors: number;
  actions: { table: string; field: string; value: string | null; action: string }[];
  total_rows: number;
  rows: { loser_key: string; survivor_key: string; table: string | null; field: string | null; value: string | null; action: string; merged_at: string | null }[];
}

/** GET /match-calibration: the object's match profile and the m and u of each rule from steward decisions. */
export function getMatchCalibration(domain: string): Promise<MatchCalibration> {
  return v2Get<MatchCalibration>("/match-calibration", { domain });
}

/** POST /match-calibration/apply: write the recommended weights, and the profile's missing rules when asked. Audited. */
export function applyMatchCalibration(body: { domain: string; reason: string; add_profile_rules: boolean }): Promise<CalibrationApplied> {
  return v2Send<CalibrationApplied>("POST", "/match-calibration/apply", body);
}

/** GET /consolidation-pack: each merged-away record, its survivor and the SAP flags that retire it. */
export function getConsolidationPack(domain: string, limit = 50): Promise<ConsolidationPack> {
  return v2Get<ConsolidationPack>("/consolidation-pack", { domain, limit });
}

export function downloadConsolidationPack(domain: string, format: "csv" | "xlsx"): Promise<string> {
  return v2Download("/consolidation-pack", { domain, format }, `consolidation-pack-${domain}.${format}`);
}
