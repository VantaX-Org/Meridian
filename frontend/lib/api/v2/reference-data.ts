/**
 * Reference data client (api/routes/reference_data.py).
 *
 *   GET  /reference-data/lists                   the managed code lists of a system, with versions and coverage
 *   GET  /reference-data/lists/{id}              one list: source codes, target codes, mappings and their status
 *   POST /reference-data/mappings                a steward proposes a source to target code mapping
 *   POST /reference-data/mappings/{id}/decision  a different user approves or rejects it (four eyes)
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
