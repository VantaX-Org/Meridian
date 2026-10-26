// Pure helpers for the Progress page: chart series and the words around the numbers. No fetching here.
import type { ChartPoint, LineSeries } from "@/design";
import type { Burndown, DecisionKind, ProposalSource } from "@/lib/api/work-analytics";
import { formatDate, formatNumber } from "@/lib/format";

export const DECISION_LABELS: Record<DecisionKind, string> = {
  accept: "Accepted suggestion",
  edit: "Typed a value",
  not_an_issue: "Not an issue",
  accept_risk: "Risk accepted",
  approve: "Approved",
};

export const SOURCE_LABELS: Record<ProposalSource, string> = {
  rule: "Rule suggestion",
  steward: "Steward's own value",
  cleaning: "Cleaning engine",
  simulation: "What-if simulation",
  manual: "Entered by hand",
};

export const sourceLabel = (s: string): string => SOURCE_LABELS[s as ProposalSource] ?? s;

/** "under a day", "1 day", "4.5 days"; a dash when nothing was fixed. */
export function daysText(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days < 1) return "under a day";
  return days === 1 ? "1 day" : `${formatNumber(days)} days`;
}

/**
 * A per-day rate as a person says it: whole numbers from 10 up ("38"), one decimal under 10 ("4.3"), "under 0.1"
 * for a trickle, never "12.345678". Magnitude only; the caller says whether it closes or adds.
 */
export function rateText(perDay: number): string {
  const a = Math.abs(perDay);
  if (a === 0) return "0";
  if (a < 0.1) return "under 0.1";
  return formatNumber(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10);
}

export const pct = (n: number | null | undefined): string => (n == null ? "—" : `${n.toLocaleString()}%`);

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** How far ahead the projection is drawn; a later finish date is stated in words. */
export const PROJECTION_HORIZON_DAYS = 90;

export interface BurndownChart {
  /** The highest open count of the window. */
  peak: number;
  series: LineSeries[];
  xDomain: { x: string; label: string }[];
  /** The target line: zero open, drawn when the projection reaches it; the axis is fitted to the data otherwise. */
  target?: number;
}

/**
 * The burn-down in open issues per day, with the projection at the recent pace from today to the finish date, weekly, at most PROJECTION_HORIZON_DAYS ahead.
 */
export function burndownChart(b: Burndown): BurndownChart {
  const peak = Math.max(1, ...b.days.map((d) => d.open));
  const share = (n: number) => Math.max(0, Math.round(n));
  const label = (day: string) => formatDate(day);
  const open: ChartPoint[] = b.days.map((d) => ({ x: d.day, y: share(d.open), label: label(d.day) }));
  const xDomain = b.days.map((d) => ({ x: d.day, label: label(d.day) }));
  const series: LineSeries[] = [{ name: "Open", data: open }];
  if (b.projected_finish && b.pace_per_day > 0 && b.open_now > 0) {
    const ahead = Math.min(daysBetween(b.today, b.projected_finish), PROJECTION_HORIZON_DAYS);
    const steps = new Set<number>([0, ahead]);
    for (let i = 7; i < ahead; i += 7) steps.add(i);
    const projected = [...steps].sort((x, y) => x - y).map((i) => {
      const day = addDays(b.today, i);
      return { x: day, y: share(b.open_now - b.pace_per_day * i), label: label(day) };
    });
    for (const p of projected.slice(1)) xDomain.push({ x: p.x, label: p.label });
    series.push({ name: "Projected", data: projected });
    return { peak, series, xDomain, target: 0 };
  }
  return { peak, series, xDomain };
}

/** "clears on 4 Nov 2026", or why there is no date. */
export function finishSentence(b: Burndown): string {
  if (b.open_now === 0) return "Nothing is open";
  if (!b.projected_finish) {
    return b.pace_per_day < 0
      ? `More is opening than closing: ${rateText(b.pace_per_day)} a day net over ${b.pace_window_days} days`
      : `No net progress over the last ${b.pace_window_days} days, so there is no finish date`;
  }
  return `At ${rateText(b.pace_per_day)} a day net, the backlog clears on ${formatDate(b.projected_finish)}`;
}
