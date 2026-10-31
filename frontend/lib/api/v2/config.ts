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

export type { AlignmentFinding, ConfigDriftEntry, ConfigElement, ConfigHealthScore, LicenceUtilisation, ProcessHealth, ProcessStep } from "@/lib/api/config-intelligence";

export const getConfigHealth = () => v2Get<{ run_id: string; scores: ConfigHealthScore[] }>("/config/health-score");
export const getConfigInventory = () => v2Get<{ run_id: string; total: number; elements: ConfigElement[] }>("/config/inventory");
export const getConfigProcesses = () => v2Get<{ run_id: string; processes: ProcessHealth[] }>("/config/processes");
export const getConfigAlignment = () => v2Get<AlignmentList & { total: number }>("/config/alignment");
export const getConfigDrift = () => v2Get<{ current_run_id: string; previous_run_id: string; drift_entries: ConfigDriftEntry[] }>("/config/drift");
export const getConfigLicence = () => v2Get<{ run_id: string; modules: LicenceUtilisation[] }>("/config/licence-utilisation");
export const rediscoverConfig = () => v2Send<{ queued: boolean; version_id: string }>("POST", "/config/discover/latest");
