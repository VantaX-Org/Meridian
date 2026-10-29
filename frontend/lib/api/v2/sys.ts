/**
 * Step 6b clients: system connection (register, edit, rotate credentials, test, delete), extraction schedules, the
 * extraction scope, the SPRO/FO configuration of a system (areas, items, source, drift, comparison with a target) and
 * custom Z objects. Every call is an existing endpoint of the current backend with the shapes of the old clients
 * (lib/api/systems.ts, config-load.ts, config-pairing.ts, config-intelligence.ts, z-objects.ts); in fixture mode the
 * answers come from lib/api/v2/fixtures/sys6b.ts.
 */
import { v2Get, v2Send } from "./client";
import type { SAPSystem, SyncProfile, SystemType, TestConnectionResponse } from "@/types/api";
import type { ConfigCompare, ProposeResult } from "@/lib/api/config-pairing";
import type { ConfigDriftEntry } from "@/lib/api/config-intelligence";
import type { DownloadScope } from "@/lib/api/system-objects";
import type { ZAnomaly, ZAnomalyVerdict, ZCustomRule, ZCustomRuleBody, ZDormant, ZDrift, ZGhost, ZMapping, ZProfile, ZRegistryEntry, ZRegistryPatch, ZReport, ZRuleTemplate } from "@/lib/api/z-objects";

export type { ConfigCompare, ProposeResult, ConfigDriftEntry, DownloadScope, ZAnomaly, ZDormant, ZDrift, ZGhost, ZMapping, ZProfile, ZRegistryEntry, ZReport, ZRuleTemplate, ZCustomRule };

/* ---- connection ---- */

export interface ConnectionBody {
  name: string;
  system_type: SystemType;
  environment: string;
  description?: string;
  host?: string;
  client?: string;
  sysnr?: string;
  username?: string;
  base_url?: string;
  company_id?: string;
  auth_type?: string;
  token_url?: string;
  /** RFC: { password }. Cloud: { client_id, client_secret, api_key, password }. Only the secrets that were typed. */
  credentials: Record<string, string>;
}

export interface SystemPatch {
  name?: string;
  host?: string;
  client?: string;
  sysnr?: string;
  username?: string;
  base_url?: string;
  company_id?: string;
  auth_type?: string;
  /** "" clears it. */
  token_url?: string;
  description?: string;
  environment?: string;
  is_active?: boolean;
  /** Only the secrets the user retyped; an absent key keeps the stored value. */
  credentials?: Record<string, string>;
  role?: "source" | "target";
  /** "" clears the target. */
  target_system_id?: string;
}

/** POST /systems */
export const registerSystem = (body: ConnectionBody): Promise<SAPSystem> => v2Send<SAPSystem>("POST", "/systems", body);
/** PUT /systems/{id} */
export const updateSystem = (id: string, body: SystemPatch): Promise<SAPSystem> => v2Send<SAPSystem>("PUT", `/systems/${encodeURIComponent(id)}`, body);
/** DELETE /systems/{id}: the credentials and schedules go with it; extracted runs and findings stay. */
export const deleteSystem = (id: string): Promise<void> => v2Send<void>("DELETE", `/systems/${encodeURIComponent(id)}`);
/** POST /systems/test-connection: tries a draft that is not saved. */
export const testDraftConnection = (body: ConnectionBody): Promise<TestConnectionResponse> => v2Send<TestConnectionResponse>("POST", "/systems/test-connection", body);
/** POST /systems/{id}/test-connection: tries the edited fields; a secret left out falls back to the stored one. Nothing is saved. */
export const testEditedConnection = (id: string, body: ConnectionBody): Promise<TestConnectionResponse> =>
  v2Send<TestConnectionResponse>("POST", `/systems/${encodeURIComponent(id)}/test-connection`, body);

/* ---- schedules ---- */

export interface ProfileBody {
  system_id: string;
  domain: string;
  tables: string[];
  schedule_cron?: string;
  active?: boolean;
  extraction_mode?: "full" | "delta";
}
export interface ProfilePatch {
  schedule_cron?: string;
  active?: boolean;
  extraction_mode?: "full" | "delta";
}

export const createProfile = (systemId: string, body: ProfileBody): Promise<SyncProfile> => v2Send<SyncProfile>("POST", `/systems/${encodeURIComponent(systemId)}/profiles`, body);
export const updateProfile = (systemId: string, profileId: string, body: ProfilePatch): Promise<SyncProfile> =>
  v2Send<SyncProfile>("PATCH", `/systems/${encodeURIComponent(systemId)}/profiles/${encodeURIComponent(profileId)}`, body);
export const deleteProfile = (systemId: string, profileId: string): Promise<void> =>
  v2Send<void>("DELETE", `/systems/${encodeURIComponent(systemId)}/profiles/${encodeURIComponent(profileId)}`);

/* ---- configuration ---- */

export interface SproConfig {
  module: string;
  /** live_snapshot | live | baseline | mixed */
  source: string;
  /** Per table: live_snapshot | live | baseline | unavailable */
  table_sources: Record<string, string>;
  tables: Record<string, Record<string, unknown>[]>;
  field_purposes: Record<string, { config_table?: string; description?: string; impacts_features?: string[] }>;
}

/** GET /spro/config/{module}?system_id= */
export const getSproConfig = (module: string, systemId: string): Promise<SproConfig> => v2Get<SproConfig>(`/spro/config/${encodeURIComponent(module)}`, { system_id: systemId });

export interface ConfigItems {
  system_id: string;
  object: string;
  items: { key: string; values: Record<string, unknown> }[];
}
/** GET /connectivity/config-load/{id}/items?object=: the rows of one configuration object of the latest completed load. */
export const getConfigItems = (systemId: string, object: string): Promise<ConfigItems> =>
  v2Get<ConfigItems>(`/connectivity/config-load/${encodeURIComponent(systemId)}/items`, { object, limit: 500 });

export interface ConfigDrift {
  current_run_id: string;
  previous_run_id: string;
  drift_entries: ConfigDriftEntry[];
}
/** GET /config/drift: tenant-wide; the API answers 404 until two runs exist. */
export const getConfigDriftLog = (): Promise<ConfigDrift> => v2Get<ConfigDrift>("/config/drift");

/** GET /config-pairing/compare/{id}: the system's configuration against its target (or the SAP standard baseline). */
export const getConfigCompare = (systemId: string, object?: string): Promise<ConfigCompare> =>
  v2Get<ConfigCompare>(`/config-pairing/compare/${encodeURIComponent(systemId)}`, { object });
/** POST /config-pairing/propose/{id}: sends key and description matches to the steward queue. Needs analyse. */
export const proposeConfigMatches = (systemId: string): Promise<ProposeResult> => v2Send<ProposeResult>("POST", `/config-pairing/propose/${encodeURIComponent(systemId)}`);

/* ---- custom Z objects ---- */

export const getZRegistry = (): Promise<{ total: number; entries: ZRegistryEntry[] }> => v2Get("/z-objects/registry");
export const getZProfile = (id: string): Promise<ZProfile> => v2Get(`/z-objects/profile/${encodeURIComponent(id)}`);
export const getZAnomalies = (): Promise<{ run_id: string; total: number; anomalies: ZAnomaly[] }> => v2Get("/z-objects/anomalies");
export const getZGhost = (): Promise<ZGhost[]> => v2Get("/z-objects/ghost");
export const getZDormant = (): Promise<ZDormant[]> => v2Get("/z-objects/dormant");
export const getZDrift = (): Promise<ZDrift[]> => v2Get("/z-objects/drift");
export const getZRules = (): Promise<{ templates: ZRuleTemplate[]; custom_rules: ZCustomRule[] }> => v2Get("/z-objects/rules");
export const getZReport = (): Promise<ZReport> => v2Get("/z-objects/report");
export const getZMapping = (): Promise<{ total: number; mappings: ZMapping[] }> => v2Get("/z-objects/mapping");
/** PUT /z-objects/registry/{id}: owner, purpose, standard equivalent, status, notes. Needs manage_rules. */
export const updateZEntry = (id: string, patch: ZRegistryPatch): Promise<ZRegistryEntry> => v2Send<ZRegistryEntry>("PUT", `/z-objects/registry/${encodeURIComponent(id)}`, patch);
/** POST /z-objects/anomalies/{id}/feedback: "dismissed" marks it expected, "confirmed" marks it to investigate. Needs ai_feedback. */
export const feedbackZAnomaly = (id: string, status: ZAnomalyVerdict): Promise<ZAnomaly> => v2Send<ZAnomaly>("POST", `/z-objects/anomalies/${encodeURIComponent(id)}/feedback`, { status });
/** POST /z-objects/rules. Needs manage_rules. */
export const createZRule = (body: ZCustomRuleBody): Promise<{ id: string; status: string }> => v2Send("POST", "/z-objects/rules", body);
/** POST /z-objects/detect/latest: reruns detection on the latest stored data. Needs analyse. */
export const detectZ = (systemId?: string): Promise<{ queued: boolean; version_id: string }> => v2Send("POST", "/z-objects/detect/latest", undefined, { system_id: systemId });
/** POST /config/discover/latest: reruns configuration discovery on the latest stored data. Needs analyse. */
export const discoverConfig = (systemId?: string): Promise<{ queued: boolean; version_id: string }> => v2Send("POST", "/config/discover/latest", undefined, { system_id: systemId });
