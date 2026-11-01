/** Maintenance windows fixture, shaped like api/routes/status_page.py. The PUT validates and replaces the list. */
import type { MaintenanceWindow } from "../maintenance";

export const NONE_MAINTENANCE = Symbol("not a maintenance path");

const at = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setMinutes(0, 0, 0); return d.toISOString(); };

let windows: MaintenanceWindow[] | null = null;
const state = (): MaintenanceWindow[] =>
  (windows ??= [{ id: "mw-1", title: "Database upgrade", starts_at: at(50), ends_at: at(52), detail: "Postgres minor version upgrade. Runs and syncs are held." }]);

export const resetMaintenanceFixture = (): void => { windows = null; };

function refuse(detail: string): never {
  throw Object.assign(new Error(detail), { status: 422, response: { status: 422, data: { detail } } });
}

export function maintenanceRead(path: string): unknown {
  return path === "/settings/maintenance" ? { windows: state() } : NONE_MAINTENANCE;
}

export function maintenanceWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "PUT" || path !== "/settings/maintenance") return NONE_MAINTENANCE;
  const list = ((body as { windows?: MaintenanceWindow[] })?.windows ?? []).map((w, i) => {
    if (!/(Z|[+-]\d\d:\d\d)$/.test(w.starts_at) || !/(Z|[+-]\d\d:\d\d)$/.test(w.ends_at)) refuse("Give maintenance times with a time zone");
    if (Date.parse(w.ends_at) <= Date.parse(w.starts_at)) refuse("A maintenance window must end after it starts");
    return { ...w, id: `mw-${i + 1}`, title: w.title.trim(), starts_at: new Date(w.starts_at).toISOString(), ends_at: new Date(w.ends_at).toISOString() };
  });
  windows = list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { windows };
}
