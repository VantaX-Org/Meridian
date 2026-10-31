/**
 * Re-check objects (api/routes/sync_trigger.py): GET /sync-trigger/modules lists every object with its latest analysis,
 * POST /sync-trigger/trigger re-scores the latest stored extraction of each, and needs trigger_sync. An object with no
 * stored extraction comes back in skipped.
 */
import { v2Get, v2Send } from "./client";

export interface ModuleStatus {
  module_id: string;
  label: string;
  category: string;
  status: "idle" | "running" | "completed" | "failed";
  last_run_at: string | null;
  last_version_id: string | null;
}

export const getTriggerModules = (): Promise<ModuleStatus[]> => v2Get("/sync-trigger/modules");
export const triggerModules = (module_ids: string[]): Promise<{ queued: string[]; skipped: string[] }> =>
  v2Send("POST", "/sync-trigger/trigger", { module_ids, trigger: "manual" });
