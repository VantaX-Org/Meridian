"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, EmptyState, ErrorState, Pill, Skeleton, Sparkline } from "@/design";
import { getTrends, type TrendFlag, type TrendSummary } from "@/lib/api/system-objects";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";
import { queryKeys } from "@/lib/query-keys";
import { runPageHref } from "@/lib/runs";
import { COUNT_DEFS } from "@/lib/counts";

const FLAG_LABEL: Record<TrendFlag, string> = {
  scope_changed: "Scope changed",
  rules_changed: "Rules changed",
  volume_shift: "Volume shifted",
  incomplete_extract: "Incomplete extract",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const deltaInk = (n: number) => (n > 0 ? "[color:var(--m-pass)]" : n < 0 ? "m-ink-critical" : "m-ink-2");

type TrendPoint = { x: string; label: string | undefined; y: number };
type TrendRow = { s: TrendSummary; pts: TrendPoint[] };

/** One row per object; a DataTable so the headers sit over their own columns ("Score", "Last change"), never run together. */
const columns: ColumnDef<TrendRow>[] = [
  { id: "object", header: "Object", accessorFn: (r) => formatModuleName(r.s.object) },
  {
    id: "score", header: COUNT_DEFS.score.label, meta: { numeric: true }, accessorFn: (r) => r.s.dqs ?? -1,
    cell: ({ row: { original: { s } } }) => (s.dqs == null ? "—" : <DrillLink href={`/objects/${s.object}`}>{s.dqs.toFixed(1)}</DrillLink>),
  },
  {
    id: "delta", header: "Last change", meta: { numeric: true }, accessorFn: (r) => r.s.dqs_delta ?? 0,
    cell: ({ row: { original: { s } } }) => (s.dqs_delta == null ? "—" : <span className={deltaInk(s.dqs_delta)}>{signed(s.dqs_delta)}</span>),
  },
  {
    id: "trend", header: "Trend", enableSorting: false,
    cell: ({ row: { original: { s, pts } } }) => (pts.length >= 2 ? (
      // The trend opens the latest run of this object, scoped to that run and object.
      <Link
        href={runPageHref(pts[pts.length - 1].x, { module: s.object })}
        aria-label={`Open the latest run of ${formatModuleName(s.object)}, ${pts[pts.length - 1].label}`}
        title={`DQS from ${pts[0].label} to ${pts[pts.length - 1].label}: ${pts.map((p) => p.y).join(" → ")}`}
        className="inline-block"
      >
        <Sparkline data={pts} />
      </Link>
    ) : "—"),
  },
  {
    id: "baseline", header: "Since baseline", meta: { numeric: true }, accessorFn: (r) => r.s.vs_baseline?.dqs_delta ?? 0,
    cell: ({ row: { original: { s } } }) => (s.vs_baseline ? <span className={deltaInk(s.vs_baseline.dqs_delta)}>{signed(s.vs_baseline.dqs_delta)}</span> : "—"),
  },
  {
    id: "notes", header: "Notes", enableSorting: false,
    cell: ({ row: { original: { s } } }) => (s.flags.length ? (
      <span className="flex flex-wrap gap-1">{s.flags.map((f) => <Pill key={f} tone="at-risk">{FLAG_LABEL[f]}</Pill>)}</span>
    ) : "—"),
  },
];

/** Score per object across this system's analysed runs. A change is only meaningful when the
 *  point is comparable (same scope, rule set and record volume); flags say why it is not. */
export function TrendPanel({ systemId }: { systemId: string }) {
  const q = useQuery({ queryKey: queryKeys.systemTrends(systemId), queryFn: () => getTrends(systemId, undefined, true) });
  if (q.isLoading) return <Skeleton height={96} />;
  if (isListFailure(q)) {
    return <ErrorState message={apiErrorMessage(q.error) || "Trends could not be read."} onRetry={() => q.refetch()} />;
  }
  const summary = q.data?.summary ?? [];
  const series = q.data?.series ?? {};
  // Keyed by run id with the date as the label, so the sparkline's title names dates, never raw timestamps or upload labels.
  const rows: TrendRow[] = summary.map((s) => {
    const scored = (series[s.object] ?? []).filter((p) => p.dqs !== null);
    const ticks = runAxisTicks(scored.map((p) => ({ id: p.version_id, run_at: p.run_at })));
    return { s, pts: scored.map((p) => ({ x: p.version_id, label: ticks.get(p.version_id), y: p.dqs as number })) };
  });
  return (
    <Card title="Trend per object" meta="How each object's score moved across runs. Notes flag a change that is not a like-for-like comparison">
      {!summary.length ? (
        <EmptyState title="No analysed run yet" detail="Trends need at least one analysed run." action={<Button render={<Link href={`/systems/${systemId}?tab=objects`}>Run analysis</Link>} />} />
      ) : (
        <DataTable columns={columns} data={rows} getRowId={(r) => r.s.object} height="auto" hideToolbar tableId="system-trend" />
      )}
      {summary.length > 0 && Object.values(series).every((s) => s.length < 2) ? (
        <EmptyState title="Only one analysed run" detail="A second analysis shows how each object moves." action={<Button render={<Link href={`/systems/${systemId}?tab=objects`}>Run a second analysis</Link>} />} />
      ) : null}
    </Card>
  );
}
