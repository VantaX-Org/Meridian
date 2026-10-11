import apiClient from "./client";

export interface ZRegistryEntry {
  id: string;
  category: string;
  module: string;
  object_name: string;
  standard_equivalent: string | null;
  description: string | null;
  owner: string | null;
  created_date: string | null;
  last_active_date: string | null;
  status: string;
  transaction_count_total: number;
  rules_applied: string[];
  notes: string | null;
}
export interface ZProfile {
  object_name: string;
  data_type: string;
  cardinality: number;
  null_rate: number;
  transaction_count: number;
  user_count: number;
  first_seen: string | null;
  last_seen: string | null;
  trend_direction: string | null;
  related_standard_field: string | null;
}
export interface ZAnomaly {
  id: string | null;
  object_name: string;
  anomaly_type: string;
  severity: string;
  description: string;
  baseline_value: string | null;
  current_value: string | null;
  deviation_pct: number;
  status: string;
}
export interface ZGhost {
  object_name: string;
  category: string;
  module: string;
  source_field: string;
  last_active_date: string | null;
  status: string;
}
export interface ZDormant {
  object_name: string;
  category: string;
  module: string;
  last_active_date: string | null;
  months_inactive: number;
}
export interface ZDrift {
  object_name: string;
  module: string;
  source_field: string;
  change_type: string;
  first_detected: string | null;
}

const get = async <T>(path: string): Promise<T> => (await apiClient.get(`/api/v1/z-objects/${path}`)).data;

export const getZRegistry = () => get<{ total: number; entries: ZRegistryEntry[] }>("registry");
export const getZProfile = (id: string) => get<ZProfile>(`profile/${id}`);
export const getZAnomalies = () => get<{ run_id: string; total: number; anomalies: ZAnomaly[] }>("anomalies");
export const getZGhost = () => get<ZGhost[]>("ghost");
export const getZDormant = () => get<ZDormant[]>("dormant");
export const getZDrift = () => get<ZDrift[]>("drift");
