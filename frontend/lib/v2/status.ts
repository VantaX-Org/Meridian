import type { ComponentStatus, MaintenanceWindow, OverallStatus, StatusPage } from "@/lib/api/v2/enterprise";
import { t } from "@/lib/v2/i18n";

/** One day of the 30-day bar: its UTC date, how many health samples ran, the share that was up, and what follows. */
export interface DayCell {
  day: string;
  slots: number;
  uptimePct: number | null;
  state: "ok" | "degraded" | "down" | "none";
}

const DAY = 86_400_000;

/**
 * The server's per-day uptime (GET /status/page `uptime.by_day`) laid out as the last `days` UTC days ending on the
 * day the page was generated: a day at 100% is ok, one above half is degraded, one at half or less is down. A day the
 * server has no sample for says so rather than claiming either.
 */
export function dayCells(uptime: StatusPage["uptime"], generatedAt: string, days = 30): DayCell[] {
  const end = Math.floor((Date.parse(generatedAt) || Date.now()) / DAY);
  const by = new Map(uptime.by_day.map((d) => [d.date, d]));
  const out: DayCell[] = [];
  for (let d = end - days + 1; d <= end; d++) {
    const day = new Date(d * DAY).toISOString().slice(0, 10);
    const row = by.get(day);
    const pct = row && row.slots > 0 ? row.uptime_pct : null;
    const state: DayCell["state"] = pct == null ? "none" : pct >= 100 ? "ok" : pct > 50 ? "degraded" : "down";
    out.push({ day, slots: row?.slots ?? 0, uptimePct: pct, state });
  }
  return out;
}

/** The maintenance window to show: the one in progress, else the next ahead (the server sends only windows not ended). */
export function currentMaintenance(windows: readonly MaintenanceWindow[]): MaintenanceWindow | null {
  return windows.find((w) => w.in_progress) ?? windows[0] ?? null;
}

/** The word for the platform as a whole. */
export function overallWord(s: OverallStatus): string {
  return s === "operational" ? t("Operational") : s === "degraded" ? t("Degraded") : t("Outage");
}

/** The verdict mark for the platform as a whole: shape and word, never colour alone. */
export const overallVerdict = (s: OverallStatus): "go" | "at-risk" | "no-go" => (s === "operational" ? "go" : s === "degraded" ? "at-risk" : "no-go");

/** The word for one component's state. */
export function statusWord(s: ComponentStatus): string {
  return s === "up" ? t("Operational") : s === "degraded" ? t("Degraded") : s === "down" ? t("Down") : t("Not configured");
}
