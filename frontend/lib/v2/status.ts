import type { ComponentStatus, StatusPage } from "@/lib/api/v2/enterprise";
import { t } from "@/lib/v2/i18n";

/** One day of the 30-day bar: its UTC date, how many probes ran and how many failed, and the state that follows. */
export interface DayCell {
  day: string;
  total: number;
  failed: number;
  state: ComponentStatus | "none";
}

const DAY = 86_400_000;

/**
 * The probes folded into one cell per UTC day, the last `days` days ending on the newest probe (or `now`): a day with
 * no failure is ok, one where fewer than half failed is degraded, and one where half or more failed is down. A day
 * with no probe says so rather than claiming either.
 */
export function dayCells(samples: StatusPage["samples"], days = 30, now?: string): DayCell[] {
  const newest = samples.reduce((m, s) => Math.max(m, Date.parse(s.at) || 0), 0);
  const end = now ? Date.parse(now) : newest || Date.now();
  const endDay = Math.floor(end / DAY);
  const by = new Map<number, { total: number; failed: number }>();
  for (const s of samples) {
    const d = Math.floor(Date.parse(s.at) / DAY);
    if (!Number.isFinite(d) || d > endDay || d <= endDay - days) continue;
    const cur = by.get(d) ?? { total: 0, failed: 0 };
    cur.total += 1;
    if (!s.ok) cur.failed += 1;
    by.set(d, cur);
  }
  const out: DayCell[] = [];
  for (let d = endDay - days + 1; d <= endDay; d++) {
    const c = by.get(d) ?? { total: 0, failed: 0 };
    const state: DayCell["state"] = c.total === 0 ? "none" : c.failed === 0 ? "ok" : c.failed * 2 < c.total ? "degraded" : "down";
    out.push({ day: new Date(d * DAY).toISOString().slice(0, 10), ...c, state });
  }
  return out;
}

const RANK: Record<ComponentStatus, number> = { ok: 0, degraded: 1, down: 2 };

/** The worst state of the components: what the status strip's health word says. */
export function overallStatus(components: StatusPage["components"]): ComponentStatus {
  return components.reduce<ComponentStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "ok");
}

/** Whether a maintenance window is on now, still ahead, or over. */
export function maintenanceState(m: StatusPage["maintenance"], now = Date.now()): "now" | "ahead" | "over" | null {
  if (!m) return null;
  const from = Date.parse(m.from);
  const to = Date.parse(m.to);
  if (now < from) return "ahead";
  if (now <= to) return "now";
  return "over";
}

/** The word for a component's state: shape and word, never colour alone. */
export function statusWord(s: ComponentStatus): string {
  return s === "ok" ? t("Operational") : s === "degraded" ? t("Degraded") : t("Down");
}
