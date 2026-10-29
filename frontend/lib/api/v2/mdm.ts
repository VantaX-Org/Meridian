import { v2Get, v2Send } from "./client";
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
