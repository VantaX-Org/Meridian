/**
 * Connectivity (api/routes/connectivity.py). Reads: a system's modules with their sync state, and the configuration
 * snapshot pulled for one module. Writes, all needing trigger_sync on the system: a background health check, a
 * configuration pull and a module extraction. Each write answers with the job it queued.
 */
import { v2Get, v2Send } from "./client";
import type { ExtractTarget, ExtractTargetChoice } from "./extract-target";

export interface SystemModule {
  module: string;
  system_type: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  row_count: number;
  config_synced: boolean;
  /** Registry sources whose names are not yet verified against SAP. */
  preview_sources: { source: string; reason: string }[];
}

export interface ConfigSnapshotTable {
  table: string;
  data: unknown;
  record_count: number | null;
  source: string | null;
  synced_at: string | null;
}

export interface ConfigSnapshot {
  system_id: string;
  module: string;
  tables: ConfigSnapshotTable[];
}

const enc = encodeURIComponent;

export const listSystemModules = (systemId: string): Promise<SystemModule[]> =>
  v2Get(`/connectivity/systems/${enc(systemId)}/modules`);

export const getConfigSnapshot = (systemId: string, module: string): Promise<ConfigSnapshot> =>
  v2Get(`/connectivity/config/${enc(systemId)}/${enc(module)}`);

export const healthCheck = (systemId: string): Promise<{ job_id: string; status: string }> =>
  v2Send("POST", `/connectivity/health-check/${enc(systemId)}`, {});

export const syncConfig = (systemId: string, modules: string[]): Promise<{ job_id: string; status: string }> =>
  v2Send("POST", "/connectivity/config-sync", { system_id: systemId, modules });

export const extractModules = (
  systemId: string,
  modules: string[],
  target?: ExtractTargetChoice,
): Promise<{ job_id: string; version_id: string; status: string; modules: string[]; extract_target?: ExtractTarget | null }> =>
  v2Send("POST", "/connectivity/extract", {
    system_id: systemId,
    modules,
    include_config: true,
    sync_type: "both",
    ...(target?.target_system_id ? { target_system_id: target.target_system_id } : {}),
    ...(target?.target_template_ids ? { target_template_ids: target.target_template_ids } : {}),
  });
