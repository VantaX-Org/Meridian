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

export interface ConfigTopFailing {
  check_id: string;
  module: string;
  severity: string;
  affected_count: number;
}

export interface ConfigAwareTally {
  applicable: number;
  not_applicable: number;
  passes: number;
  /** passes / applicable, 0 to 100; null when nothing applies. */
  score: number | null;
  not_applicable_reasons: { reason: string; count: number }[];
  top_failing: ConfigTopFailing[];
}

export interface ConfigAwareL2 extends ConfigAwareTally { l2: string; name: string }
export interface ConfigAwareL1 extends ConfigAwareTally { l1: string; name: string; l2: ConfigAwareL2[] }

export interface ConfigAwareScore {
  version_id: string;
  config_load: { load_id: string; system_type: SystemType; loaded_at: string } | null;
  existing_dqs: { composite: number | null };
  config_aware: ConfigAwareTally;
  processes: ConfigAwareL1[];
  unmapped: ConfigAwareTally | null;
}

export async function getConfigAwareScore(params: { system_id?: string; version_id?: string }): Promise<ConfigAwareScore> {
  const { data } = await apiClient.get<ConfigAwareScore>("/api/v1/findings/config-aware-score", { params });
  return data;
}
