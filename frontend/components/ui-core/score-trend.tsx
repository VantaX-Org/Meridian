"use client";

import Link from "next/link";
import { Chip, LineChart } from "@/components/aurora";

/** A line needs this many points to say anything; fewer, and the runs are listed with their change. */
export const MIN_TREND_POINTS = 4;

export interface ScoreTrendPoint {
  /** Axis and row label, already a date (`formatDate`). */
  label: string;
  score: number;
  to: string;
}

const signed = (n: number) => (n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`);

/**
 * Score per run, oldest first. From four runs a line chart; with two or three,
 * a change chip over the runs as rows; with one, the row alone.
 */
export function ScoreTrend({ points, color, height = 220, ariaLabel, seriesLabel = "Score", onPointClick }: {
  points: ScoreTrendPoint[];
  color?: string;
  height?: number;
  ariaLabel: string;
  seriesLabel?: string;
  onPointClick: (index: number) => void;
}) {
  if (points.length >= MIN_TREND_POINTS) {
    const data = points.map((p) => ({ run: p.label, score: p.score }));
    return (
      <LineChart data={data} xKey="run" series={[{ key: "score", label: seriesLabel, color }]} height={height}
        yFormatter={(v) => v.toFixed(0)} ariaLabel={ariaLabel} onPointClick={onPointClick} />
    );
  }
  const change = points.length > 1 ? Math.round((points[points.length - 1].score - points[0].score) * 10) / 10 : null;
  return (
    <div className="ui-stack">
      {change !== null ? (
        <p className="ui-note">
          <Chip tone={change < 0 ? "danger" : change > 0 ? "success" : "neutral"}>{signed(change)}</Chip>{" "}
          since the first of these {points.length} runs. A chart needs {MIN_TREND_POINTS} runs.
        </p>
      ) : null}
      <ul className="ui-ranked">
        {[...points].reverse().map((p) => (
          <li key={p.to}>
            <Link href={p.to}>
              <span className="ui-ranked__title">{p.label}</span>
              <span className="ui-ranked__num">{p.score.toFixed(1)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
