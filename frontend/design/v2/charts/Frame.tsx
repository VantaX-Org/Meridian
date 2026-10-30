"use client";

import { useCallback, useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { ErrorFrame, Skeleton } from "../parts";
import "../charts.css";

/**
 * The frame every chart of the interface is drawn in (design/v2/charts). One grammar for all of them:
 *
 * - a title and a one-line reading above the plot, in ink, never in the series colour;
 * - the plot, with hairline gridlines, the axis text at 12 pixels in tabular figures, the data in the data hue or the
 *   palette tokens (--m2-chart-*, --m2-seq-*, --m2-sev-*);
 * - a legend when there are two series or more, each entry a mark and a word;
 * - one state at a time: loading (a flat placeholder at the plot's height), empty (what would fill it), error (what
 *   failed, with Retry);
 * - a text alternative: every value as a table behind "Show the figures", and the plot itself reachable by keyboard,
 *   the arrow keys stepping through the points while a live region reads each one.
 */
export type ChartState = "ready" | "loading" | "empty" | "error";

export interface ChartFrameProps {
  title?: ReactNode;
  /** One line under the title: what the chart says, or its scale. */
  sub?: ReactNode;
  /** The plot (an SVG built by one of the charts). */
  children?: ReactNode;
  legend?: ReactNode;
  /** The figures as a table, shown on request. Leave it out only when the page already shows the same table. */
  table?: ReactNode;
  state?: ChartState;
  /** The sentence of the empty state. */
  empty?: ReactNode;
  /** The sentence of the error state. */
  error?: ReactNode;
  onRetry?: () => void;
  /** The plot's height, kept by the loading and empty states so nothing moves when the data arrives. */
  height: number;
  className?: string;
  testId?: string;
  /** Headings inside the canvas are h2; inside a section h3. */
  level?: 2 | 3;
}

export function ChartFrame({ title, sub, children, legend, table, state = "ready", empty, error, onRetry, height, className, testId, level = 2 }: ChartFrameProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <figure className={`m2-viz${className ? ` ${className}` : ""}`} data-testid={testId} data-state={state}>
      {title || sub ? (
        <figcaption className="m2-viz-cap">
          {title ? <H className="m2-viz-t">{title}</H> : null}
          {sub ? <span className="m2-viz-sub">{sub}</span> : null}
        </figcaption>
      ) : null}
      {state === "loading" ? (
        <div className="m2-viz-wait" aria-busy="true" style={{ height }}>
          <span className="m2-sr">{t("Loading the chart")}</span>
          <Skeleton width="100%" height={height} />
        </div>
      ) : state === "error" ? (
        <div className="m2-viz-msg" style={{ minHeight: height }}>
          <ErrorFrame onRetry={onRetry}>{error ?? t("The figures for this chart could not be read.")}</ErrorFrame>
        </div>
      ) : state === "empty" ? (
        <div className="m2-viz-msg m2-viz-empty" style={{ minHeight: height }} data-testid="chart-empty">
          <p>{empty ?? t("Nothing to draw yet.")}</p>
        </div>
      ) : (
        <>
          {children}
          {legend}
          {table ? (
            <details className="m2-viz-tbl">
              <summary>{t("Show the figures")}</summary>
              {table}
            </details>
          ) : null}
        </>
      )}
    </figure>
  );
}

export interface LegendItem {
  key: string;
  label: ReactNode;
  /** A token name, for example "--m2-chart-1"; the swatch is filled with it. */
  colour: string;
  /** The count or value beside the label. */
  value?: ReactNode;
  /** A shape that says the same as the colour (a severity mark), drawn instead of the square swatch. */
  mark?: ReactNode;
}

/** The legend: a mark and a word per series, in the series order. Text stays in ink; only the mark carries the colour. */
export function Legend({ items, label }: { items: readonly LegendItem[]; label?: string }) {
  return (
    <ul className="m2-viz-legend" aria-label={label ?? t("Legend")}>
      {items.map((i) => (
        <li key={i.key}>
          {i.mark ?? <span className="m2-viz-sw" style={{ "--m2-viz-c": `var(${i.colour})` } as React.CSSProperties} aria-hidden="true" />}
          <span>{i.label}</span>
          {i.value != null ? <span className="m2-viz-lv">{i.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The figures as a table: the chart's text alternative. The first column names each row. */
export function ChartTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <table className="m2-tbl m2-viz-table">
      <caption className="m2-sr">{caption}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={i > 0 ? "m2-r" : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) =>
              ci === 0 ? (
                <th key={ci} scope="row">
                  {c}
                </th>
              ) : (
                <td key={ci} className="m2-r">
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Pointer and keyboard over the points of a chart: the index under the pointer or chosen with the arrow keys, Home
 * and End, cleared by Escape or leaving. `positions` are the points' x (or y) in the plot's own pixels.
 */
export function usePointer(count: number, positions: readonly number[], axis: "x" | "y" = "x") {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (count === 0) return;
      // i18n-ignore: key names, not words
      const step = axis === "x" ? { prev: "ArrowLeft", next: "ArrowRight" } : { prev: "ArrowUp", next: "ArrowDown" };
      let next: number | null = active;
      // i18n-ignore: key names, not words
      if (e.key === step.next || (axis === "x" && e.key === "ArrowUp")) next = active == null ? 0 : Math.min(count - 1, active + 1);
      // i18n-ignore: key names, not words
      else if (e.key === step.prev || (axis === "x" && e.key === "ArrowDown")) next = active == null ? count - 1 : Math.max(0, active - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = count - 1;
      else if (e.key === "Escape") next = null;
      else return;
      e.preventDefault();
      setActive(next);
    },
    [active, count, axis],
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const vb = e.currentTarget.viewBox.baseVal;
      const scale = axis === "x" ? (vb && vb.width ? vb.width / box.width : 1) : vb && vb.height ? vb.height / box.height : 1;
      const p = axis === "x" ? (e.clientX - box.left) * scale : (e.clientY - box.top) * scale;
      let best = 0;
      for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i] - p) < Math.abs(positions[best] - p)) best = i;
      if (positions.length) setActive(best);
    },
    [positions, axis],
  );
  const onPointerLeave = useCallback(() => setActive(null), []);
  return { active, setActive, onKeyDown, onPointerMove, onPointerLeave };
}

/** The reading of the point in focus: shown as a tooltip beside it and said by a polite live region. */
export function Readout({ text, x, y, align = "center" }: { text: ReactNode | null; x: number; y: number; align?: "start" | "center" | "end" }) {
  const id = useId();
  return (
    <>
      {text != null ? (
        <div className="m2-viz-tip" data-align={align} style={{ left: x, top: y }} role="presentation" id={id}>
          {text}
        </div>
      ) : null}
      <span className="m2-sr" aria-live="polite">
        {text ?? ""}
      </span>
    </>
  );
}
