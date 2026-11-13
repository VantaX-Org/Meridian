"use client";

import { useEffect, useRef, useState } from "react";
import { formatInt as int } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";
import { cx } from "./cx";

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The value on screen: counts from the last value to the new one over 320 ms; the first paint and reduced motion jump. */
function useCountTo(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  // Reduced motion (or no rAF) skips the tween and reads the target straight at render, so no state is set in the effect.
  const instant = reducedMotion() || typeof requestAnimationFrame !== "function";
  useEffect(() => {
    if (from.current === target) return;
    if (instant) {
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 320);
      setShown(Math.round(origin + (target - origin) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, instant]);
  return instant ? target : shown;
}

export function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 4) + 2, h - 3 - ((p - min) / span) * (h - 6)] as const);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="nx-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <polyline className="nx-spark-line" points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="currentColor" />
    </svg>
  );
}

export interface StatCardProps {
  label: string;
  value: number;
  /** How the number is written; default is a grouped integer. */
  format?: (n: number) => string;
  /** The change since the compared run: a signed number, an arrow, and what it is against. */
  delta?: { value: number; tone?: "good" | "bad" | "neutral"; against?: string };
  spark?: number[];
  sparkLabel?: string;
}

export function StatCard({ label, value, format = int, delta, spark, sparkLabel }: StatCardProps) {
  const shown = useCountTo(value);
  const dir = delta ? (delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat") : null;
  return (
    <div className="nx-card nx-stat">
      <div className="nx-stat-label">{label}</div>
      <div className="nx-stat-row">
        <span className="nx-stat-value" data-testid="stat-value">
          <span className="nx-sr">{format(value)}</span>
          <span aria-hidden="true">{format(shown)}</span>
        </span>
        {spark ? <Sparkline points={spark} label={sparkLabel ?? t("Trend of {label}", { label })} /> : null}
      </div>
      {delta && dir ? (
        <div className={cx("nx-stat-delta", `nx-tone-${delta.tone ?? "neutral"}`)}>
          <Icon name={dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "minus"} />
          <span>
            {delta.value > 0 ? "+" : ""}
            {format(delta.value)}
          </span>
          <span className="nx-sr">{dir === "up" ? t("up") : dir === "down" ? t("down") : t("unchanged")}</span>
          {delta.against ? <span className="nx-stat-against">{delta.against}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
