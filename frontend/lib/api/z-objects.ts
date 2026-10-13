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

export type ZRegistryStatus = "active" | "dormant" | "deprecated" | "under_review";
/** The fields PUT /z-objects/registry/{id} accepts; omitted fields stay as they are. */
export interface ZRegistryPatch {
  description?: string;
  owner?: string;
  standard_equivalent?: string;
  status?: ZRegistryStatus;
  notes?: string;
}

/** PUT /api/v1/z-objects/registry/{id} */
export async function updateZRegistryEntry(id: string, patch: ZRegistryPatch): Promise<ZRegistryEntry> {
  const { data } = await apiClient.put<ZRegistryEntry>(`/api/v1/z-objects/registry/${encodeURIComponent(id)}`, patch);
  return data;
}

/** "dismissed" marks the anomaly as expected; "confirmed" marks it for investigation. */
export type ZAnomalyVerdict = "confirmed" | "dismissed";

/** POST /api/v1/z-objects/anomalies/{id}/feedback */
export async function submitZAnomalyFeedback(id: string, status: ZAnomalyVerdict): Promise<ZAnomaly> {
  const { data } = await apiClient.post<ZAnomaly>(`/api/v1/z-objects/anomalies/${encodeURIComponent(id)}/feedback`, { status });
  return data;
}

export interface ZRuleTemplate {
  template_id: string;
  name: string;
  description: string;
  default_severity: string;
  applicable_to: string;
}
export interface ZCustomRule {
  id: string;
  z_object_id: string | null;
  rule_template_id: string | null;
  rule_name: string;
  custom_condition: string | null;
  severity: string;
  is_active: boolean;
  created_at: string | null;
}
export interface ZCustomRuleBody {
  z_object_id?: string;
  rule_name: string;
  custom_condition: string;
  severity: "critical" | "high" | "medium" | "low";
}

/** GET /api/v1/z-objects/rules: the rule templates and this tenant's custom Z rules. */
export const getZRules = () => get<{ templates: ZRuleTemplate[]; custom_rules: ZCustomRule[] }>("rules");

/** POST /api/v1/z-objects/rules */
export async function createZRule(body: ZCustomRuleBody): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.post<{ id: string; status: string }>("/api/v1/z-objects/rules", body);
  return data;
}

export interface ZReport {
  total_z_objects: number;
  by_status: Record<string, number>;
  by_module: Record<string, number>;
  by_category: Record<string, number>;
  active_anomalies: number;
  ghost_objects: number;
  dormant_objects: number;
  mapped_to_standard: number;
  unmapped: number;
}

/** GET /api/v1/z-objects/report */
export const getZReport = () => get<ZReport>("report");

export interface ZMapping {
  object_name: string;
  module: string;
  standard_equivalent: string | null;
  confidence: number;
  mapping_source: "auto" | "manual";
}

/** GET /api/v1/z-objects/mapping: Z objects and the standard SAP field each one maps to. */
export const getZMapping = () => get<{ total: number; mappings: ZMapping[] }>("mapping");

/** POST /api/v1/z-objects/detect/latest: reruns Z-object detection on the latest stored data (records are read server side). */
export async function detectZObjectsNow(systemId?: string): Promise<{ queued: boolean; version_id: string }> {
  const { data } = await apiClient.post<{ queued: boolean; version_id: string }>("/api/v1/z-objects/detect/latest", null, { params: { system_id: systemId } });
  return data;
}
