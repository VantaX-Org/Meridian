"use client";

import { useState } from "react";
import { BarChart } from "./charts";

export const AGE_BUCKETS = [
  { id: "0-2", label: "0 to 2 days", min: 0, max: 3 },
  { id: "3-7", label: "3 to 7 days", min: 3, max: 8 },
  { id: "8-14", label: "8 to 14 days", min: 8, max: 15 },
  { id: "15-30", label: "15 to 30 days", min: 15, max: 31 },
  { id: "30+", label: "Over 30 days", min: 31, max: Infinity },
] as const;

const SEVERITY = [
  { key: "critical", label: "Critical", color: "var(--aurora-status-danger-500)" },
  { key: "high", label: "High", color: "var(--aurora-status-warning-500)" },
  { key: "medium", label: "Medium", color: "var(--aurora-status-info-500)" },
  { key: "low", label: "Low", color: "var(--aurora-status-success-500)" },
];

/** Open issues by age, stacked by severity. Selecting a bucket reports its id. */
export function AgeingBars({ issues, onBucketClick, height = 240 }: {
  issues: ReadonlyArray<{ first_seen_at: string; severity: string }>;
  onBucketClick?: (bucketId: string) => void;
  height?: number;
}) {
  const [now] = useState(() => Date.now());
  const data = AGE_BUCKETS.map((b) => {
    const row: Record<string, number | string> = { bucket: b.label, critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) {
      const d = (now - new Date(i.first_seen_at).getTime()) / 86_400_000;
      if (d >= b.min && d < b.max) {
        const k = SEVERITY.some((s) => s.key === i.severity) ? i.severity : "medium";
        row[k] = (row[k] as number) + 1;
      }
    }
    return row;
  });
  return (
    <BarChart
      data={data}
      xKey="bucket"
      series={SEVERITY}
      stacked
      height={height}
      ariaLabel="Open issues by age, stacked by severity. Select a bar to list its issues."
      onBarClick={onBucketClick ? (i) => onBucketClick(AGE_BUCKETS[i].id) : undefined}
    />
  );
}
