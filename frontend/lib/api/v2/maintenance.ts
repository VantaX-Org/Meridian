/**
 * Scheduled maintenance windows (api/routes/status_page.py): GET and PUT /settings/maintenance, manage_settings.
 * The PUT replaces the whole list; the backend stores times in UTC and sorts the windows by start.
 */
import { v2Get, v2Send } from "./client";

export interface MaintenanceWindow {
  id?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  detail: string | null;
}

export const MAX_WINDOWS = 20;

export const getMaintenance = (): Promise<{ windows: MaintenanceWindow[] }> => v2Get("/settings/maintenance");
export const putMaintenance = (windows: MaintenanceWindow[]): Promise<{ windows: MaintenanceWindow[] }> =>
  v2Send("PUT", "/settings/maintenance", { windows: windows.map(({ title, starts_at, ends_at, detail }) => ({ title, starts_at, ends_at, detail })) });
