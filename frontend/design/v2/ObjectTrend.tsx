"use client";

import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { runLabel } from "@/lib/v2/run-label";
import { f1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Legend, TrendChart, linear, niceTicks } from "./charts";
import "./runs.css";

/**
 * One object's measured score over its own finished runs, in three sizes of the same series: the ribbon inline in a
 * table row (120 by 20), the header strip (320 by 44) and the full card (full width by 220). Every point carries the
 * run's name and date; a one-run object says in words that the trend starts at the second run.
 */
export type TrendSize = "inline" | "header" | "card";

interface Pt {
  id: string;
  value: number;
  name: string;
  date: string;
  title: string;
}

/** The runs of one object that hold a measured score, oldest first. */
export function trendPoints(runs: readonly TimelineRun[], module: string, system: string | null | undefined): Pt[] {
  return runs.flatMap((r) => {
    const o = r.objects[module];
    const v = o ? (o.raw_score ?? o.score) : null;
    if (v == null) return [];
    const name = runLabel(system, r.run_number);
    const date = formatDate(r.run_at, "date");
    return [{ id: r.id, value: v, name, date, title: t("{name}, {date}: measured {score}", { name, date, score: f1(v) }) }];
  });
}

const SIZE = { inline: [120, 20], header: [320, 44] } as const;

/** The range the ribbon is drawn on: the data, widened to at least 6 points so a flat series stays flat. */
function rangeOf(values: readonly number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const half = Math.max(3, (hi - lo) / 2);
  return [Math.max(0, mid - half), Math.min(100, mid + half)];
}

export function ObjectTrend({ runs, module, system, object, size, selectedId, testId }: { runs: readonly TimelineRun[]; module: string; system?: string | null; object: string; size: TrendSize; selectedId?: string | null; testId?: string }) {
  const pts = useMemo(() => trendPoints(runs, module, system), [runs, module, system]);
  const values = pts.map((p) => p.value);
  const range = useMemo(() => (values.length ? rangeOf(values) : ([0, 100] as [number, number])), [values]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const says = last && first && pts.length > 1 ? t("{object}: {n} runs, measured {from} on {d1} to {to} on {d2}", { object, n: pts.length, from: f1(first.value), d1: first.date, to: f1(last.value), d2: last.date }) : "";

  if (pts.length < 2) {
    const why = pts.length === 1 ? t("One run so far: the trend starts at the second run.") : t("No scored run yet.");
    if (size === "card")
      return (
        <p className="m2-ot-empty" data-testid={testId}>
          {pts.length === 1 ? t("{object} has one scored run so far, {name}, measured {score}. The trend chart starts at the second run.", { object, name: pts[0].name, score: f1(pts[0].value) }) : t("{object} has no scored run yet. The trend chart starts when two runs have scored it.", { object })}
        </p>
      );
    return (
      <span className="m2-ot-empty" title={why} data-testid={testId}>
        {size === "inline" ? t("1 run") : why}
      </span>
    );
  }

  if (size === "card") {
    const [lo, hi] = rangeOf(values);
    const ticks = niceTicks(lo, hi, 4);
    const domain: [number, number] = [Math.min(lo, ticks[0] ?? lo), Math.max(hi, ticks[ticks.length - 1] ?? hi)];
    return (
      <div data-testid={testId}>
        <TrendChart
          points={pts.map((p) => ({ id: p.id, label: p.date.replace(/\s+\d{4}$/, ""), title: p.title, value: p.value }))}
          domain={domain}
          ticks={ticks}
          label={says}
          yLabel={t("Measured score, 0 to 100")}
          format={f1}
          height={220}
        />
        <Legend items={[{ key: "line", label: t("{object}, measured score per finished run (before any cap). Hover a point for its run and date.", { object }), colour: "--m2-chart-1" }]} />
      </div>
    );
  }

  const [w, h] = SIZE[size];
  const padX = size === "header" ? 30 : 3;
  const pad = 3;
  const x = (i: number) => padX + ((w - 2 * padX) * i) / (pts.length - 1);
  const y = linear(range, [h - pad, pad]);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg className="m2-ot" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={says} data-testid={testId} data-size={size}>
      <title>{says}</title>
      <polyline className="m2-ot-l" points={line} />
      {pts.map((p, i) => (
        <circle key={p.id} className={p.id === selectedId ? "m2-ot-d m2-ot-sel" : i === pts.length - 1 ? "m2-ot-d m2-ot-last" : "m2-ot-d"} cx={x(i)} cy={y(p.value)} r={size === "header" ? 3 : 1.6}>
          <title>{p.title}</title>
        </circle>
      ))}
      {size === "header" ? (
        <>
          <text className="m2-ot-t" x={0} y={y(first.value) + 4}>{f1(first.value)}</text>
          <text className="m2-ot-t" x={w} y={y(last.value) + 4} textAnchor="end">{f1(last.value)}</text>
        </>
      ) : null}
    </svg>
  );
}
