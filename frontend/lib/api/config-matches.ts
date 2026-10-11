/** API client for config matches (api/routes/config_matches.py): standard-rule vs live-config mismatches per run. */
import apiClient from "./client";
import { downloadAuthenticated } from "./download";

export interface ConfigMatch {
  module: string;
  check_id: string;
  record_key: string | null;
  field: string | null;
  actual_value: string | null;
  std_rule_expectation: string | null;
  classification: string;
  config_evidence: string | null;
  recommended_action: string | null;
  sap_tcode: string | null;
  fix_priority: number | null;
}

export function getConfigMatchesExportUrl(versionId: string): string {
  return `/api/v1/versions/${versionId}/config-matches/export`;
}

export async function getConfigMatches(versionId: string): Promise<{ items: ConfigMatch[]; total: number }> {
  return (await apiClient.get(`/api/v1/versions/${versionId}/config-matches`, { params: { limit: 500 } })).data;
}

/** XLSX workbook; the endpoint needs the `export` permission and answers 404 when the run has no matches. */
export function exportConfigMatches(versionId: string): Promise<void> {
  return downloadAuthenticated(getConfigMatchesExportUrl(versionId), `config_matches_${versionId}.xlsx`);
}
