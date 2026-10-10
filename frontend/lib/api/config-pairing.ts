import apiClient from "./client";
import { downloadBlob } from "./download";

export type MatchStatus = "exists" | "key_match" | "desc_match" | "missing";

export interface MatchRow {
  object: string;
  source_key: string;
  status: MatchStatus;
  target_key: string | null;
  score: number | null;
  field: string | null;
  source_value: string | null;
  target_value: string | null;
  description: string | null;
  proposable: boolean;
}

export interface CompareObject {
  object: string;
  exists: number;
  key_match: number;
  desc_match: number;
  missing: number;
  proposable: number;
}

export interface CompareTarget {
  system_id: string | null;
  label: string;
  baseline: boolean;
}

export interface ConfigCompare {
  source_load_id: string | null;
  target: CompareTarget;
  objects: CompareObject[];
  rows: MatchRow[];
}

export interface ProposeResult {
  proposed: number;
  skipped: number;
  target: string;
}

export interface FindingContext {
  object: string | null;
  system_id: string | null;
  target_label: string;
  baseline: boolean;
  source: string[];
  target: string[];
  missing: string[];
  missing_total: number;
}

/** Value-map scope as written in the realignment report's "scope" column. */
export type ValueMapScope = "global" | "source" | "pair";

export const SCOPE_LABEL: Record<ValueMapScope, string> = {
  global: "Global",
  source: "This source",
  pair: "This pair",
};

export async function getConfigCompare(systemId: string, object?: string): Promise<ConfigCompare> {
  const { data } = await apiClient.get<ConfigCompare>(`/api/v1/config-pairing/compare/${systemId}`, {
    params: { object },
  });
  return data;
}

export async function proposeConfigMatches(systemId: string): Promise<ProposeResult> {
  const { data } = await apiClient.post<ProposeResult>(`/api/v1/config-pairing/propose/${systemId}`);
  return data;
}

export async function getFindingContext(p: {
  ruleId: string; module: string; versionId?: string; fields: string[];
}): Promise<FindingContext | null> {
  const { data } = await apiClient.get<FindingContext | null>("/api/v1/config-pairing/finding-context", {
    params: { rule_id: p.ruleId, module: p.module, version_id: p.versionId, fields: p.fields },
    paramsSerializer: { indexes: null },
  });
  return data;
}

export function downloadRealignment(runId: string, fmt: "xlsx" | "pdf"): Promise<void> {
  return downloadBlob(`/api/v1/migration/runs/${runId}/realignment.${fmt}`, {}, `config_realignment_${runId}.${fmt}`);
}
