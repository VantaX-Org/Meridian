/**
 * Config intelligence client: the configuration Meridian reads back out of the transactions of the latest run.
 *
 * Endpoints (api/routes/config_intelligence.py); every list answers 404 until a config run exists:
 *   GET  /config/health-score, /config/inventory, /config/processes, /config/alignment, /config/drift,
 *        /config/licence-utilisation
 *   POST /config/discover/latest  (queues a rerun on the latest analysed version, 202)
 */
import type { AlignmentList, ConfigDriftEntry, ConfigElement, ConfigHealthScore, LicenceUtilisation, ProcessHealth } from "@/lib/api/config-intelligence";
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

export type { AlignmentFinding, ConfigDriftEntry, ConfigElement, ConfigHealthScore, LicenceUtilisation, ProcessHealth, ProcessStep } from "@/lib/api/config-intelligence";

export const getConfigHealth = () => v2Get<{ run_id: string; scores: ConfigHealthScore[] }>("/config/health-score");
export const getConfigInventory = () => v2Get<{ run_id: string; total: number; elements: ConfigElement[] }>("/config/inventory");
export const getConfigProcesses = () => v2Get<{ run_id: string; processes: ProcessHealth[] }>("/config/processes");
export const getConfigAlignment = () => v2Get<AlignmentList & { total: number }>("/config/alignment");
export const getConfigDrift = () => v2Get<{ current_run_id: string; previous_run_id: string; drift_entries: ConfigDriftEntry[] }>("/config/drift");
export const getConfigLicence = () => v2Get<{ run_id: string; modules: LicenceUtilisation[] }>("/config/licence-utilisation");
export const rediscoverConfig = () => v2Send<{ queued: boolean; version_id: string }>("POST", "/config/discover/latest");

/**
 * Config matches (api/routes/config_matches.py): for one analysed version, each failing record the config engine
 * judged to be a data error, a configuration deviation or ambiguous. `run_id` of the config reads is the version id.
 */
export type ConfigMatchClass = "data_error" | "config_deviation" | "ambiguous";
export interface ConfigMatch {
  module: string;
  check_id: string;
  record_key: string | null;
  field: string | null;
  actual_value: string | null;
  std_rule_expectation: string | null;
  classification: ConfigMatchClass;
  config_evidence: string | null;
  recommended_action: string | null;
  sap_tcode: string | null;
  fix_priority: number | null;
}
export interface ConfigMatchSummary {
  data_errors: number;
  config_deviations: number;
  ambiguous: number;
  modules_with_deviations: string[];
}
export const getConfigMatches = (versionId: string, classification?: ConfigMatchClass) =>
  v2Get<{ items: ConfigMatch[]; total: number; limit: number; offset: number }>(`/versions/${encodeURIComponent(versionId)}/config-matches`, { classification, limit: 500 });
/** The API answers `{ message }` instead of the counts when the version has no summary. */
export const getConfigMatchSummary = (versionId: string) =>
  v2Get<ConfigMatchSummary | { message: string }>(`/versions/${encodeURIComponent(versionId)}/config-matches/summary`);
export const downloadConfigMatches = (versionId: string) =>
  v2Download(`/versions/${encodeURIComponent(versionId)}/config-matches/export`, undefined, "config-matches.xlsx");
