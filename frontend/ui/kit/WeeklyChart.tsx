"use client";

import { t } from "@/lib/v2/i18n";
import { compactCount } from "../screens/object/format";
import { PlotLayer } from "./PlotLayer";

/** One cell of the weekly chart: a week and what happened in it. */
export interface Week { period: string; applied: number; verified: number; rolled: number }

/** Findings applied and verified per week. Same hover, keyboard and `onSelect` contract as RunLines. */
export function WeeklyChart({ weeks, onSelect }: { weeks: Week[]; onSelect?: (week: Week) => void }) {
  const W = 480, H = 150, L = 34, R = 8, T = 10, B = 26;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.applied, w.verified]));
  const x = (i: number) => L + (weeks.length === 1 ? 0 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / max;
  const line = (k: "applied" | "verified") => weeks.map((w, i) => `${x(i)},${y(w[k])}`).join(" ");
  const label = t("Findings applied and verified by week");
  const describe = (i: number) => `${weeks[i].period}: ${t("Applied")} ${compactCount(weeks[i].applied)}, ${t("Verified")} ${compactCount(weeks[i].verified)}`;
  return (
    <PlotLayer n={weeks.length} label={label} describe={describe} onSelect={onSelect ? (i) => onSelect(weeks[i]) : undefined} inset={{ start: L / W, end: R / W }}>
      <svg className="mx-clean-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className="mx-rl-gate" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
        <text className="mx-ruler-ax" x={L - 4} y={y(max) + 4} textAnchor="end" fontSize={10}>{compactCount(max)}</text>
        <text className="mx-ruler-ax" x={L - 4} y={y(0) + 4} textAnchor="end" fontSize={10}>0</text>
        <polyline className="mx-rl-measured" points={line("verified")} fill="none" />
        <polyline className="mx-rl-shown" points={line("applied")} fill="none" />
        {weeks.map((w, i) => <circle key={w.period} className="mx-rl-dot" cx={x(i)} cy={y(w.applied)} r={3} />)}
        <text className="mx-ruler-ax" x={L} y={H - 4} fontSize={10}>{weeks[0].period}</text>
        <text className="mx-ruler-ax" x={W - R} y={H - 4} textAnchor="end" fontSize={10}>{weeks[weeks.length - 1].period}</text>
        <title>{t("Applied, verified")}</title>
      </svg>
    </PlotLayer>
  );
}
