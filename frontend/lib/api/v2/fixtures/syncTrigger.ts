/** Re-check objects fixture, shaped like api/routes/sync_trigger.py. A trigger marks the queued objects running. */
import type { ModuleStatus } from "../syncTrigger";

export const NONE_SYNC_TRIGGER = Symbol("not a sync-trigger path");

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// module, label, category, status, hours since the last analysis (null: never analysed)
const ROWS: [string, string, string, ModuleStatus["status"], number | null][] = [
  ["material_master", "Material Master", "ECC", "completed", 20],
  ["business_partner", "Business Partner", "ECC", "completed", 26],
  ["fi_gl", "FI General Ledger", "ECC", "failed", 30],
  ["accounts_payable", "Accounts Payable", "ECC", "completed", 50],
  ["plant_maintenance", "Plant Maintenance", "ECC", "running", 1],
  ["employee_central", "Employee Central", "SuccessFactors", "idle", null],
  ["ewms_stock", "eWMS Stock", "Warehouse", "idle", null],
];

let rows: ModuleStatus[] | null = null;
const state = (): ModuleStatus[] =>
  (rows ??= ROWS.map(([module_id, label, category, status, h]) => ({ module_id, label, category, status, last_run_at: h === null ? null : ago(h), last_version_id: null })));

export const resetSyncTriggerFixture = (): void => { rows = null; };

export function syncTriggerRead(path: string): unknown {
  return path === "/sync-trigger/modules" ? state() : NONE_SYNC_TRIGGER;
}

export function syncTriggerWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/sync-trigger/trigger") return NONE_SYNC_TRIGGER;
  const queued: string[] = [], skipped: string[] = [];
  for (const id of (body as { module_ids?: string[] })?.module_ids ?? []) {
    const m = state().find((x) => x.module_id === id);
    if (!m?.last_run_at) { skipped.push(id); continue; }
    m.status = "running";
    queued.push(id);
  }
  return { queued, skipped };
}
