import apiClient from "./client";

/** Config intelligence is tenant-wide (api/routes/config_intelligence.py); every list answers 404 until a run exists. */
export type ConfigStatus = "active" | "dormant" | "ghost";
export interface ConfigElement {
  module: string;
  element_type: string;
  element_value: string;
  transaction_count: number;
  first_seen: string | null;
  last_seen: string | null;
  status: ConfigStatus;
  sap_reference_table: string;
}
export interface ProcessStep {
  step_number: number;
  step_name: string;
  sap_table: string;
  detected: boolean;
  volume: number;
  exception_count: number;
  avg_days_to_next_step: number | null;
}
export interface ProcessHealth {
  process_id: string;
  process_name: string;
  status: "active" | "partial" | "inactive";
  completeness_score: number;
  steps: ProcessStep[];
  exception_rate: number;
  bottleneck_step: string | null;
  total_volume: number;
  avg_cycle_days: number | null;
}
export interface AlignmentFinding {
  check_id: string;
  module: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  affected_elements: string[];
  remediation: string;
  /** Priced from the tenant cost model, in the list's `currency` (the name is historical, not rand). */
  estimated_impact_zar: number;
}
/** A list of alignment findings with the currency of their estimated impact (the tenant cost model's). */
export interface AlignmentList {
  run_id: string;
  findings: AlignmentFinding[];
  currency?: string | null;
}
export interface ConfigHealthScore {
  module: string;
  chs: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}
export interface ConfigDriftEntry {
  module: string;
  element_type: string;
  element_value: string;
  change_type: string;
  previous_value: string | null;
  current_value: string | null;
}
export interface LicenceUtilisation {
  module: string;
  total_config_elements: number;
  total_transactions: number;
  utilisation_pct: number;
  status: string;
}

const get = async <T>(path: string): Promise<T> => (await apiClient.get(`/api/v1/config/${path}`)).data;

export const getConfigInventory = () => get<{ run_id: string; elements: ConfigElement[] }>("inventory");
export const getConfigProcesses = () => get<{ run_id: string; processes: ProcessHealth[] }>("processes");
export const getConfigAlignment = () => get<AlignmentList>("alignment");
export const getConfigGhost = () => get<AlignmentList>("ghost");
export const getConfigShadow = () => get<AlignmentList>("shadow");
export const getConfigDrift = () =>
  get<{ current_run_id: string; previous_run_id: string; drift_entries: ConfigDriftEntry[] }>("drift");
export const getConfigLicence = () => get<{ run_id: string; modules: LicenceUtilisation[] }>("licence-utilisation");
export const getConfigHealth = () => get<{ run_id: string; scores: ConfigHealthScore[] }>("health-score");

/** GET /api/v1/config/inventory/{module}: the elements of one module in the latest run. */
export const getConfigInventoryByModule = (module: string) =>
  get<{ run_id: string; elements: ConfigElement[] }>(`inventory/${encodeURIComponent(module)}`);
/** GET /api/v1/config/alignment/{module}: the alignment findings of one module in the latest run. */
export const getConfigAlignmentByModule = (module: string) =>
  get<{ run_id: string; findings: AlignmentFinding[] }>(`alignment/${encodeURIComponent(module)}`);

export type RootCauseType = "bad_data" | "bad_config" | "bad_data_and_config" | "process_gap";
export interface RootCause {
  finding_id: string;
  root_cause_type: RootCauseType;
  data_issue: string | null;
  config_issue: string | null;
  process_issue: string | null;
  recommendation: string;
}

/** GET /api/v1/config/root-cause/{finding_id}: 404 when the finding is not an alignment finding of that run. */
export async function getConfigRootCause(findingId: string, runId?: string): Promise<RootCause> {
  const { data } = await apiClient.get<RootCause>(`/api/v1/config/root-cause/${encodeURIComponent(findingId)}`, { params: { run_id: runId } });
  return data;
}

/** POST /api/v1/config/discover/latest: reruns config discovery and Z-object profiling on the latest stored data. */
export async function discoverConfigNow(systemId?: string): Promise<{ queued: boolean; version_id: string }> {
  const { data } = await apiClient.post<{ queued: boolean; version_id: string }>("/api/v1/config/discover/latest", null, { params: { system_id: systemId } });
  return data;
}
