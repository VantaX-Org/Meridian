import type { DqsForecast } from "@/lib/api/v2/analytics";

/**
 * Reading a module's forecast at a go-live date. The backend fits a least-squares line through the daily scores
 * (day 0 the latest) and stores the 7, 30 and 90 day points with their 95% intervals; a horizon the history cannot
 * support is null. The same line is refitted here from `history` so the runway can draw it and read it at any day,
 * and nothing is read past the furthest horizon the backend stored.
 */

export interface Line {
  intercept: number;
  slope: number;
}

export function fitLine(points: readonly { day: number; score: number }[]): Line | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.day, 0) / n;
  const my = points.reduce((s, p) => s + p.score, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.day - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, p) => s + (p.day - mx) * (p.score - my), 0) / sxx;
  return { intercept: my - slope * mx, slope };
}

export const lineAt = (l: Line, day: number): number => Math.min(100, Math.max(0, l.intercept + l.slope * day));

const HORIZONS = [7, 30, 90] as const;

/** The stored horizons in day order: [day, low, high], only those the backend measured. */
export function bands(f: DqsForecast): [number, number, number][] {
  return HORIZONS.flatMap((h) => {
    const lo = f[`forecast_${h}d_low`];
    const hi = f[`forecast_${h}d_high`];
    return lo == null || hi == null ? [] : [[h, lo, hi] as [number, number, number]];
  });
}

export const maxHorizon = (f: DqsForecast): number | null => bands(f).at(-1)?.[0] ?? null;

export interface GoLiveReading {
  /** Score on the line at go-live; null when go-live lies beyond the furthest horizon. */
  score: number | null;
  low: number | null;
  high: number | null;
  /** Days from today until the line meets the target: 0 when already there, null when it never does in range. */
  crossing: number | null;
}

/** The forecast read at `day` (days from the latest run) against `target`. */
export function readAt(f: DqsForecast, day: number, target: number | null): GoLiveReading {
  const line = fitLine(f.history);
  const max = maxHorizon(f);
  const b = bands(f);
  let score: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  if (line && max != null && day >= 0 && day <= max) {
    score = lineAt(line, day);
    // ponytail: half-width interpolated linearly between the stored horizons (and zero-width-ish at day 0 from the
    // 7-day band); the true interval widens with the square root of leverage. Ask the backend for the exact day if
    // the cone needs to be exact.
    const half = halfWidthAt(b, day, line);
    low = Math.max(0, score - half);
    high = Math.min(100, score + half);
  }
  let crossing: number | null = null;
  if (line && target != null) {
    const now = lineAt(line, 0);
    if (now >= target) crossing = 0;
    else if (line.slope > 0) {
      const d = (target - line.intercept) / line.slope;
      crossing = max != null && d <= max ? d : null;
    }
  }
  return { score, low, high, crossing };
}

function halfWidthAt(b: [number, number, number][], day: number, line: Line): number {
  const half = (i: number) => Math.max(b[i][2] - lineAt(line, b[i][0]), lineAt(line, b[i][0]) - b[i][1]);
  if (!b.length) return 0;
  if (day <= b[0][0]) return half(0);
  for (let i = 1; i < b.length; i++) {
    if (day <= b[i][0]) {
      const t = (day - b[i - 1][0]) / (b[i][0] - b[i - 1][0]);
      return half(i - 1) + t * (half(i) - half(i - 1));
    }
  }
  return half(b.length - 1);
}

export type Course = "on" | "off" | "unknown";

/** On course when every module's forecast at go-live meets the target; off when any falls short; unknown otherwise. */
export function courseOf(readings: readonly (GoLiveReading | null)[], target: number | null): Course {
  if (target == null || !readings.length) return "unknown";
  if (readings.some((r) => r?.score != null && r.score < target)) return "off";
  return readings.every((r) => r?.score != null) ? "on" : "unknown";
}
