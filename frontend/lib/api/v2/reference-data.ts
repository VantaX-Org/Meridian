/**
 * Reference data client (api/routes/reference_data.py).
 *
 *   GET  /reference-data/lists                   the managed code lists of a system, with versions and coverage
 *   GET  /reference-data/lists/{id}              one list: source codes, target codes, mappings and their status
 *   POST /reference-data/mappings                a steward proposes a source to target code mapping
 *   POST /reference-data/mappings/{id}/decision  a different user approves or rejects it (four eyes)
 *   GET  /reference-data/lists/{id}/usage        which codes the records hold: orphans, unused codes, covered share
 *   POST /reference-data/suggest                 Aletheia suggests a target code; shown only when the server proved it
 *
 * A list is a check table Meridian already extracts. A mapping takes effect only when it is approved.
 */
import { v2Get, v2Send } from "./client";

export type MappingStatus = "proposed" | "confirmed" | "rejected";

export interface RefCode { code: string; text?: string | null }

export interface RefCoverage { same: number; approved: number; proposed: number; rejected: number; open: number }

export interface RefVersion { load_id: string; origin: string; finished_at?: string | null; codes: number }

export interface RefListSummary {
  id: string;
  table: string;
  module: string;
  target_fields: string[];
  source_codes: number;
  target_codes: number;
  versions: number;
  coverage: RefCoverage;
}

export interface RefLists { target_label: string; lists: RefListSummary[] }

export interface RefMapping {
  id: string;
  target_field: string;
  source_code: string;
  source_text?: string | null;
  target_code: string;
  target_text?: string | null;
  status: MappingStatus;
  note?: string | null;
  proposed_by?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
}

export interface RefList {
  id: string;
  table: string;
  module: string;
  target_fields: string[];
  target_label: string;
  version_id?: string | null;
  versions: RefVersion[];
  source: RefCode[];
  target: RefCode[];
  mappings: RefMapping[];
  coverage: RefCoverage;
}

export interface ProposeBody { system_id: string; list_id: string; target_field: string; source_code: string; target_code: string; note?: string }

export interface RefSuggestion {
  source_code: string;
  target_code: string;
  target_text?: string | null;
  confidence: number;
  reasoning: string;
  checks: { code: string; passed: boolean }[];
}

export const getRefLists = (systemId: string): Promise<RefLists> => v2Get<RefLists>("/reference-data/lists", { system_id: systemId });

export const getRefList = (systemId: string, listId: string, loadId?: string): Promise<RefList> =>
  v2Get<RefList>(`/reference-data/lists/${listId}`, { system_id: systemId, load_id: loadId });

export const proposeMapping = (body: ProposeBody): Promise<RefMapping> => v2Send<RefMapping>("POST", "/reference-data/mappings", body);

export const decideMapping = (id: string, decision: "approve" | "reject", note?: string): Promise<{ id: string; status: MappingStatus }> =>
  v2Send("POST", `/reference-data/mappings/${id}/decision`, { decision, ...(note ? { note } : {}) });

export const suggestMapping = (systemId: string, listId: string, sourceCode: string): Promise<{ suggestion: RefSuggestion | null }> =>
  v2Send("POST", "/reference-data/suggest", { system_id: systemId, list_id: listId, source_code: sourceCode });

export interface RefUsageField {
  field: string;
  profiled: boolean;
  rows: number;
  filled: number;
  covered: number;
  orphan_rows: number;
  masked: boolean;
  mask_reason?: string | null;
  truncated: boolean;
  sampled: boolean;
}

export interface RefOrphan { value: string; count: number; fields: string[] }

/** Usage of a code list in the records, from the stored field profiles of its target fields. When a profile lists
 * fewer values than the field holds, the counts are lower bounds (covered_at_least) and unused codes are not certain. */
export interface RefUsage {
  id: string;
  table: string;
  version_id?: string | null;
  run_at?: string | null;
  fields: RefUsageField[];
  orphans: RefOrphan[];
  orphans_complete: boolean;
  unused: string[];
  unused_certain: boolean;
  codes: number;
  used: number;
  filled: number;
  covered: number;
  covered_share?: number | null;
  covered_at_least: boolean;
}

export const getRefUsage = (systemId: string, listId: string): Promise<RefUsage> =>
  v2Get<RefUsage>(`/reference-data/lists/${listId}/usage`, { system_id: systemId });
