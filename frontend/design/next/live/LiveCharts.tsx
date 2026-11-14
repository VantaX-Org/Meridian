"use client";

import { sparkGeometry } from "@/design/v2/charts";
import { formatCompact, formatPct } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import type { LiveState } from "@/lib/api/next/live-runs";

/** The tone of a run's marks: one token per state, never the only signal (every chart also says it in words). */
export const toneOf = (state: LiveState): string =>
  state === "completed" ? "good" : state === "failed" ? "bad" : state === "stalled" ? "warn" : state === "running" ? "accent" : "quiet";

const R = 44;
const C = 2 * Math.PI * R;

/**
 * Overall percent as a ring. Determinate: an arc that grows to `pct` (motion.css animates the offset). Unknown: a short
 * arc that turns, with aria-busy and no value, never a made-up number.
 */
export function ProgressRing({ pct, state, label, caption }: { pct: number | null; state: LiveState; label: string; caption?: string }) {
  const det = pct != null;
  const v = det ? Math.max(0, Math.min(100, pct)) : 0;
  const text = det ? formatPct(v) : t("Working");
  return (
    <div
      className="nx-live-ring"
      data-tone={toneOf(state)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={det ? v : undefined}
      aria-valuetext={det ? text : t("Progress unknown")}
      aria-busy={!det && (state === "running" || state === "queued") ? true : undefined}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <title>{det ? `${label}: ${text}` : `${label}: ${t("Progress unknown")}`}</title>
        <circle className="nx-live-ring-track" cx="50" cy="50" r={R} />
        {det ? (
          <circle className="nx-live-ring-arc" cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform="rotate(-90 50 50)" />
        ) : state === "running" || state === "queued" ? (
          <g className="nx-live-ring-spin">
            <circle className="nx-live-ring-arc" cx="50" cy="50" r={R} strokeDasharray={`${C * 0.22} ${C}`} />
          </g>
        ) : null}
      </svg>
      <div className="nx-live-ring-label">
        <strong>{text}</strong>
        {caption ? <span>{caption}</span> : null}
      </div>
    </div>
  );
}

export interface Segment {
  id: string;
  label: string;
  /** 0 to 100, or null when this segment's own total is unknown while it runs. */
  pct: number | null;
  state: "queued" | "running" | "done" | "failed" | "skipped" | "stalled";
}

/** One segment per stage (or table): filled to its own percent; a running segment with no known total shows motion. */
export function SegmentedBar({ segments, label }: { segments: Segment[]; label: string }) {
  if (!segments.length) return null;
  const gap = 1.5;
  const w = (100 - gap * (segments.length - 1)) / segments.length;
  return (
    <svg className="nx-live-seg" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      {segments.map((s, i) => {
        const x = i * (w + gap);
        const fill = s.state === "done" || s.state === "skipped" ? 100 : s.pct ?? 0;
        const text = `${s.label}: ${s.pct != null ? formatPct(s.pct) : s.state === "done" ? formatPct(100) : stateWord(s.state)}`;
        return (
          <g key={s.id} data-state={s.state}>
            <title>{text}</title>
            <rect className="nx-live-seg-track" x={x} y={0} width={w} height={8} rx={1.5} />
            {fill > 0 ? <rect className="nx-live-seg-fill" x={x} y={0} width={(w * fill) / 100} height={8} rx={1.5} /> : null}
            {s.state === "running" && s.pct == null ? <rect className="nx-live-seg-busy" x={x} y={0} width={w} height={8} rx={1.5} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function stateWord(state: string): string {
  switch (state) {
    case "queued": return t("Queued");
    case "running": return t("Running");
    case "stalled": return t("Stalled");
    case "failed": return t("Failed");
    case "cancelled": return t("Cancelled");
    case "skipped": return t("Skipped");
    default: return t("Done");
  }
}

/** Rows per minute between the samples this tab observed. Two rates are needed for a line; fewer says so in words. */
export function ThroughputSpark({ rates, label }: { rates: number[]; label: string }) {
  if (rates.length < 2) return <p className="nx-live-spark-empty">{t("Rate appears after a few updates")}</p>;
  const peak = Math.max(...rates, 1);
  const g = sparkGeometry(rates, 120, 32, [0, peak]);
  const last = rates[rates.length - 1];
  const summary = t("{label}: now {now} rows a minute, peak {peak}", { label, now: formatCompact(Math.round(last)), peak: formatCompact(Math.round(peak)) });
  return (
    <figure className="nx-live-spark">
      <svg viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label={summary}>
        <title>{summary}</title>
        <line className="nx-live-spark-base" x1="0" y1="31" x2="120" y2="31" />
        <polyline className="nx-live-spark-line" points={g.points} />
        {g.last ? <circle className="nx-live-spark-dot" cx={g.last.x} cy={g.last.y} r="2" /> : null}
      </svg>
      <figcaption>
        <span>{t("{n} rows/min", { n: formatCompact(Math.round(last)) })}</span>
        <span className="nx-live-quiet">{t("peak {n}", { n: formatCompact(Math.round(peak)) })}</span>
      </figcaption>
    </figure>
  );
}
