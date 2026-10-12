// frontend/app/(app)/insights/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, Delta, Skeleton } from "@/design";
import { getPredictiveAnalytics } from "@/lib/api/analytics";
import { getExec, getProvenCost } from "@/lib/api/insights";
import { getVersions } from "@/lib/api/versions";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, formatMoney } from "./_components/InsightFrame";

interface Row {
  id: string;
  href: string;
  name: string;
  headline: string | null; // null while loading
  changed?: number;
  rank: number; // no-go first
  /** Own timestamp, only for pages built from the exec payload. */
  stamped?: boolean;
}

export default function InsightsIndexPage() {
  const router = useRouter();
  const dayOne = useDayOne();
  const exec = useQuery({ queryKey: queryKeys.insights("exec"), queryFn: () => getExec() });
  const runs = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });

  const forecast = useQuery({ queryKey: queryKeys.analyticsPredictive(), queryFn: () => getPredictiveAnalytics() });
  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", undefined), queryFn: () => getProvenCost({}) });

  const run = runs.data?.versions.find((v) => v.id === exec.data?.version_id) ?? runs.data?.versions[0];
  const updated = run ? relativeTime(run.run_at) : "—";
  const loading = exec.isLoading;
  const d = exec.data;

  const rows = useMemo<Row[]>(() => {
    const noGo = d?.readiness_cells.filter((c) => c.verdict === "no_go").length;
    const atRisk = d ? d.impact_rows.reduce((s, r) => s + r.value_at_risk, 0) : undefined;
    const below = d ? d.owner_rows.filter((o) => o.score < 80).length : undefined;
    const r = (id: string, name: string, headline: string | null, rank = 1, stamped = false): Row =>
      ({ id, href: `/insights/${id}`, name, headline, rank, stamped });
    return [
      r("readiness", "Readiness", noGo === undefined ? null : `${noGo} readiness cells are no-go`, noGo ? 0 : 1, true),
      r("impact", "Impact", atRisk === undefined ? null : `${formatMoney(atRisk, cost.data?.currency)} at risk across features`, 1, true),
      r("owners", "Owners", below === undefined ? null : `${below} owners below threshold`, 1, true),
      r("exec", "Executive summary", d ? (d.narrative ? d.narrative.split(/(?<=\.)\s/)[0].replace(/\.$/, "") : "Readiness, risk and owners on one page") : null, 1, true),
      r("forecast", "Forecast", "Where each module score is heading"),
      r("duplicates", "Duplicates", "Which clusters to merge first"),
      r("operations", "Operations", "Job health and queue depth"),
      r("lineage", "Lineage", "Which fields feed which guards"),
      r("mining", "Mining", "Relationships, patterns and anomalies"),
      r("process", "Process", "Which business processes are ready"),
      r("reports", "Reports", "Scheduled and saved reports"),
    ].sort((a, b) => a.rank - b.rank);
  }, [d, cost.data?.currency]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Insight", accessorKey: "name", cell: ({ row }) => <Link href={row.original.href} className="font-medium">{row.original.name}</Link> },
      { id: "headline", header: "Headline", accessorKey: "headline", enableSorting: false, cell: ({ row }) => (row.original.headline === null ? <Skeleton width={200} height={14} /> : row.original.headline) },
      { id: "changed", header: "Changed", enableSorting: false, cell: ({ row }) => (row.original.changed === undefined ? <span aria-label="No change recorded">—</span> : <Delta value={row.original.changed} />) },
      { id: "updated", header: "Updated", enableSorting: false, cell: ({ row }) => (!row.original.stamped ? "—" : runs.isLoading ? <Skeleton width={60} height={14} /> : updated) },
    ],
    [runs.isLoading, updated],
  );

  const noGoCells = d?.readiness_cells.filter((c) => c.verdict === "no_go").length;
  const declining = forecast.data?.forecasts.filter((f) => f.trend === "declining" || f.trend === "critical").length;
  const empty = !loading && !exec.isError && dayOne.status !== "loading" && !d?.version_id;

  return (
    <InsightFrame
      title="Insights"
      meta={run ? `${run.label || "Latest run"}, updated ${updated}` : undefined}
      state={exec.isError ? "error" : empty ? "empty" : undefined}
      insight={{
        loading: loading || cost.isLoading || forecast.isLoading,
        situation: { sentence: noGoCells === undefined ? "Checking readiness" : `${noGoCells} readiness cells are no-go`, tone: noGoCells ? "no-go" : "go" },
        changed: { sentence: declining === undefined ? "—" : `${declining} modules are trending down` },
        why: { sentence: cost.data ? `${formatMoney(cost.data.value_at_risk_total, cost.data.currency)} of value is at risk` : "—" },
        next: noGoCells
          ? { sentence: "Clear the no-go cells first", action: { label: "Open readiness", href: "/insights/readiness" } }
          : { sentence: "Review owner scores", action: { label: "Open owners", href: "/insights/owners" } },
      }}
      emptyProps={{
        title: "No insights yet",
        detail: "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: "Could not load insights", onRetry: () => void exec.refetch() }}
    >
      <DataTable
          columns={columns}
          data={rows}
          getRowId={(x) => x.id}
          onRowClick={(x) => router.push(x.href)}
          rowHref={(x) => x.href}
          dense
          hideToolbar
          height="auto"
          tableId="insights-index"
        />
    </InsightFrame>
  );
}
