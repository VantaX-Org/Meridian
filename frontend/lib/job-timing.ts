/** Pure time maths for a running job. All timestamps are unix seconds. */

export const STALL_AFTER_S = 10 * 60;

/** "42 s", "5 min", "2 h 5 min" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Time left, extrapolated linearly from percent done since start. Null unless 0 < percent < 100. */
export function etaSeconds(percent: number, startedAt: number, now: number): number | null {
  if (!(percent > 0 && percent < 100)) return null;
  const elapsed = now - startedAt;
  if (elapsed <= 0) return null;
  return (elapsed * (100 - percent)) / percent;
}

export function updatedAgo(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round(now - updatedAt));
  return s < 5 ? "updated just now" : `updated ${formatDuration(s)} ago`;
}

export function isStalled(status: string, updatedAt: number, now: number): boolean {
  return status === "running" && now - updatedAt > STALL_AFTER_S;
}
