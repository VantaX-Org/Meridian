import { isAxiosError } from "axios";
import apiClient from "./client";
import type { SystemType } from "@/types/api";

/** Shapes of api/routes/connectivity.py (config-load) and api/routes/findings.py (config-aware-score). */

export type ConfigObjectState = "loaded" | "empty" | "failed" | "not_available";

export interface ConfigObjectHistory {
  last_change: string | null;
  changes_in_window: number | null;
  detail?: string;
  truncated?: boolean;
}

export interface ConfigObject {
  object: string;
  state: ConfigObjectState;
  rows: number;
  detail: string;
  truncated: boolean;
  history: ConfigObjectHistory | null;
}

export interface ConfigLoadHistory {
  source: string | null;
  window_days?: number;
  since?: string;
  table_logging_off: boolean;
  detail: string;
  available?: boolean;
}

export type ConfigLoadStatus = "running" | "completed" | "failed";

export type Applicability = "applies" | "does_not_apply" | "applies_by_default" | "not_available";
export type SystemConfigState = "loaded" | "with_gaps" | "loading" | "not_loaded" | "failed" | "not_available";
export type AreaStatus = "waiting" | "running" | "loaded" | "failed" | "not_available";

/** Where a configuration object is maintained: IMG path and transaction (ABAP) or admin path (cloud). */
export interface ConfiguredIn {
  object: string | null;
  kind: "img" | "admin";
  path: string;
  tcode: string | null;
}

export interface AreaObject {
  object: string;
  label: string | null;
  state: string;
  rows: number;
  detail: string;
  cause: "auth" | "timeout" | "error" | "not_in_release" | "not_exposed" | null;
}

export interface LoadArea {
  area: string;
  label: string;
  status: AreaStatus;
  tables_total: number;
  tables_done: number;
  objects: AreaObject[];
}

export interface ConfigLoad {
  load_id: string;
  system_id: string;
  system_type: SystemType;
  role: string;
  origin: string;
  status: ConfigLoadStatus;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  flows_derived: boolean;
  config_status: SystemConfigState;
  areas: LoadArea[];
  areas_loaded: number;
  areas_total: number;
  current_area: string | null;
  summary: Partial<Record<ConfigObjectState, number>>;
  objects: ConfigObject[];
  history: ConfigLoadHistory;
}

export interface ConfigLoadStarted {
  job_id: string;
  load_id: string;
  status: string;
  system_type: SystemType;
}

export async function startConfigLoad(systemId: string): Promise<ConfigLoadStarted> {
  const { data } = await apiClient.post<ConfigLoadStarted>("/api/v1/connectivity/config-load", { system_id: systemId });
  return data;
}

/** Latest load of the system, or null when none has run (the API answers 404). */
export async function getConfigLoad(systemId: string): Promise<ConfigLoad | null> {
  try {
    const { data } = await apiClient.get<ConfigLoad>(`/api/v1/connectivity/config-load/${systemId}`);
    return data;
  } catch (e) {
    if (isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

export interface SystemConfigStatus {
  system_id: string;
  name: string | null;
  system_type: SystemType;
  status: SystemConfigState;
  load_id: string | null;
  job_id: string | null;
  loaded_at: string | null;
  areas_loaded: number;
  areas_total: number;
  current_area: string | null;
  error: string | null;
}

export interface LandscapeConfigStatus {
  systems: SystemConfigStatus[];
  counts: Partial<Record<SystemConfigState, number>>;
  /** Systems loaded, of `total` systems whose configuration can be read. */
  loaded: number;
  total: number;
}

/** Configuration status of every active system, latest load each. */
export async function getConfigLandscape(): Promise<LandscapeConfigStatus> {
  const { data } = await apiClient.get<LandscapeConfigStatus>("/api/v1/connectivity/config-load");
  return data;
}

export interface ConfigTopFailing {
  check_id: string;
  module: string;
  severity: string | null;
  title: string | null;
  affected_count: number;
}

export interface NotApplicableRule {
  check_id: string;
  module: string;
  severity: string | null;
  title: string | null;
  reason: string | null;
}

export interface ConfigAwareTally {
  applicable: number;
  not_applicable: number;
  passes: number;
  /** Rules kept in the denominator because configuration is not loaded or not readable. */
  by_default: number;
  /** passes / applicable, 0 to 100; null when nothing applies. */
  score: number | null;
  not_applicable_reasons: { reason: string | null; count: number }[];
  not_applicable_rules: NotApplicableRule[];
  top_failing: ConfigTopFailing[];
}

export interface ConfigAwareL2 extends ConfigAwareTally { l2: string; name: string; configured_in: ConfiguredIn[] }
export interface ConfigAwareModule extends ConfigAwareTally { module: string }

export interface ConfigAwareRule {
  check_id: string;
  module: string;
  severity: string | null;
  title: string | null;
  affected_count: number;
  applicability: Applicability;
  reason: string | null;
  object: string | null;
}
export interface ConfigAwareL1 extends ConfigAwareTally { l1: string; name: string; l2: ConfigAwareL2[] }

export interface ConfigAwareScore {
  version_id: string;
  system_type: SystemType | null;
  config_load: { load_id: string; system_type: SystemType; loaded_at: string } | null;
  existing_dqs: { composite: number | null } | null;
  config_aware: ConfigAwareTally;
  processes: ConfigAwareL1[];
  unmapped: ConfigAwareTally | null;
  modules: ConfigAwareModule[];
  rules: ConfigAwareRule[];
}

export interface SystemApplicability {
  system_id: string;
  name: string | null;
  system_type: SystemType;
  applicability: Applicability;
  reason: string | null;
  object: string | null;
  configured_in: ConfiguredIn[];
}

export interface RuleApplicability {
  check_id: string;
  module: string;
  object: string | null;
  systems: SystemApplicability[];
}

/** Where a rule applies: one row per active system. `module` is needed only for a rule that is not shipped. */
export async function getRuleApplicability(checkId: string, module?: string): Promise<RuleApplicability> {
  const { data } = await apiClient.get<RuleApplicability>(`/api/v1/findings/rules/${encodeURIComponent(checkId)}/applicability`, { params: { module } });
  return data;
}

export async function getConfigAwareScore(params: { system_id?: string; version_id?: string }): Promise<ConfigAwareScore> {
  const { data } = await apiClient.get<ConfigAwareScore>("/api/v1/findings/config-aware-score", { params });
  return data;
}
