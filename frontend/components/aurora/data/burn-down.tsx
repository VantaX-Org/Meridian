"use client";

import { LineChart } from "./charts";

export interface BurnDownWeek {
  week: string;
  opened: number;
  resolved: number;
}

/**
 * Open issues at the end of each week, with what opened and what closed.
 * `openNow` anchors the last week; earlier weeks are worked back from it.
 */
export function BurnDown({ weeks, openNow, onWeekClick, height = 260 }: {
  weeks: ReadonlyArray<BurnDownWeek>;
  openNow: number;
  onWeekClick?: (week: string) => void;
  height?: number;
}) {
  const data = [...weeks].reverse().reduce<Array<{ week: string; Open: number; Opened: number; Resolved: number }>>((acc, w) => {
    const open = acc.length ? Math.max(0, acc[acc.length - 1].Open - acc[acc.length - 1].Opened + acc[acc.length - 1].Resolved) : openNow;
    acc.push({ week: w.week.slice(5), Open: open, Opened: w.opened, Resolved: w.resolved });
    return acc;
  }, []).reverse();
  return (
    <LineChart
      data={data}
      xKey="week"
      series={[{ key: "Open", label: "Open at week end" }, { key: "Opened", label: "Opened" }, { key: "Resolved", label: "Resolved" }]}
      height={height}
      ariaLabel="Burn-down: open issues at the end of each week. Select a week to list its issues."
      onPointClick={onWeekClick ? (i) => { if (weeks[i]) onWeekClick(weeks[i].week); } : undefined}
    />
  );
}
