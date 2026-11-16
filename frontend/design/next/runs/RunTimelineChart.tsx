"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { formatDate } from "@/lib/format";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { shortDate } from "./format";
import "./runs.css";

export interface TimelinePoint {
  id: string;
  x: number;
  /** Axis label, or null where it would touch a neighbour's. */
  label: string | null;
  selected: boolean;
  baseline: boolean;
}

export interface TimelineGeometry {
  width: number;
  height: number;
  axisY: number;
  left: number;
  right: number;
  points: TimelinePoint[];
}

const LABEL_GAP = 46;

/**
 * Lays the runs out on a date axis: x is proportional to the time between the first and the last run, so a gap of a
 * month looks like a month. The selected run and the baseline always keep their label; the others keep theirs when
 * there is room.
 */
export function timelineLayout<R extends Pick<TimelineRun, "id" | "run_at" | "baseline">>(runs: readonly R[], width: number, selectedId: string | null, tick: (r: R) => string = (r) => shortDate(r.run_at)): TimelineGeometry {
  const left = 28;
  const right = 28;
  const times = runs.map((r) => (r.run_at ? new Date(r.run_at).getTime() : 0));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = Math.max(1, width - left - right);
  const xs = times.map((v) => (t1 === t0 ? left + span / 2 : left + (span * (v - t0)) / (t1 - t0)));
  const shown = new Set<number>();
  runs.forEach((r, i) => {
    if (r.id === selectedId || r.baseline) shown.add(i);
  });
  runs.forEach((_, i) => {
    if (shown.has(i)) return;
    if ([...shown].every((j) => Math.abs(xs[j] - xs[i]) >= LABEL_GAP)) shown.add(i);
  });
  return {
    width,
    height: 100,
    axisY: 52,
    left,
    right,
    points: runs.map((r, i) => ({ id: r.id, x: xs[i], label: shown.has(i) ? tick(r) : null, selected: r.id === selectedId, baseline: r.baseline })),
  };
}

/** The width of an element, kept up to date; `fallback` until it has a size (and in tests, which have no layout). */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const x = Math.round(el.getBoundingClientRect().width);
      if (x > 0) setW(x);
    };
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface RunTimelineChartProps {
  runs: readonly TimelineRun[];
  selectedId: string | null;
  onPick: (id: string) => void;
  /** Accessible name of the group. */
  label?: string;
  fallbackWidth?: number;
  /** The axis label of a run; the short date when absent. */
  tick?: (r: TimelineRun) => string;
}

/**
 * A date axis with one square per run, the baseline marked by a rule and the word, the selected run in the data hue
 * with a bold label. Every run is a button; Enter or Space picks it, the arrow keys move between them.
 */
export function RunTimelineChart({ runs, selectedId, onPick, label, fallbackWidth = 520, tick }: RunTimelineChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(box, fallbackWidth);
  const g = useMemo(() => timelineLayout(runs, width, selectedId, tick), [runs, width, selectedId, tick]);
  const onKey = (e: ReactKeyboardEvent<SVGGElement>, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(g.points[i].id);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      box.current?.querySelectorAll<SVGGElement>("[data-run-id]")[i + (e.key === "ArrowRight" ? 1 : -1)]?.focus();
    }
  };
  return (
    <div ref={box} className="nx-tl-box">
      <svg className="nx-tl" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="group" aria-label={label ?? t("Runs on a date axis")} data-testid="run-timeline">
        <line className="nx-tl-axis" x1={g.left} x2={g.width - g.right} y1={g.axisY} y2={g.axisY} />
        {g.points
          .filter((p) => p.baseline)
          .map((p) => (
            <g key={`b${p.id}`} data-testid="tl-baseline">
              <line className="nx-tl-base" x1={p.x} x2={p.x} y1={26} y2={74} />
              <text className="nx-tl-text" x={p.x} y={16} textAnchor="middle">
                {t("baseline")}
              </text>
            </g>
          ))}
        {g.points.map((p, i) => {
          const at = runs.find((r) => r.id === p.id)?.run_at;
          const full = t("Run {run_at}{value}{value2}", { run_at: formatDate(at, "datetime"), value: p.baseline ? t(", baseline") : "", value2: p.selected ? t(", selected") : "" });
          return (
            <g
              key={p.id}
              className="nx-tl-run"
              role="button"
              tabIndex={0}
              aria-label={full}
              aria-pressed={p.selected}
              data-run-id={p.id}
              data-selected={p.selected ? "true" : undefined}
              onClick={() => onPick(p.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <title>{full}</title>
              <rect className="nx-tl-hit" x={p.x - 16} y={30} width={32} height={50} />
              <rect className="nx-tl-mark" x={p.x - (p.selected ? 6 : 4)} y={g.axisY - (p.selected ? 6 : 4)} width={p.selected ? 12 : 8} height={p.selected ? 12 : 8} />
              {p.label ? (
                <text className="nx-tl-text" x={p.x} y={92} textAnchor="middle">
                  {p.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
