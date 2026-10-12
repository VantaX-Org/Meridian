// frontend/app/(app)/insights/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Pill, Skeleton, type PillTone } from "@/design";
import { getExec } from "@/lib/api/insights";
import { getVersions } from "@/lib/api/versions";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame } from "./_components/InsightFrame";

interface Row {
  id: string;
  href: string;
  name: string;
  headline: string | null; // null while loading
  status: { label: string; tone: PillTone } | null;
  rank: number; // no-go first
}

const money = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 0 });

export default function InsightsIndexPage() {
  const router = useRouter();
  const dayOne = useDayOne();
  const exec = useQuery({ queryKey: queryKeys.insights("exec"), queryFn: () => getExec() });
  const runs = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });

  const run = runs.data?.versions.find((v) => v.id === exec.data?.version_id) ?? runs.data?.versions[0];
  const updated = run ? relativeTime(run.run_at) : "—";
  const loading = exec.isLoading;
  const d = exec.data;

  const rows = useMemo<Row[]>(() => {
    const noGo = d?.readiness_cells.filter((c) => c.verdict === "no_go").length;
    const atRisk = d ? d.impact_rows.reduce((s, r) => s + r.value_at_risk, 0) : undefined;
    const below = d ? d.owner_rows.filter((o) => o.score < 80).length : undefined;
    const r = (id: string, name: string, headline: string | null, status: Row["status"] = null, rank = 1): Row =>
      ({ id, href: `/insights/${id}`, name, headline, status, rank });
    return [
      r("readiness", "Readiness", noGo === undefined ? null : `${noGo} wave and module cells are no-go`, noGo === undefined ? null : noGo > 0 ? { label: "No-go", tone: "no-go" } : { label: "Go", tone: "go" }, noGo ? 0 : 1),
      r("impact", "Impact", atRisk === undefined ? null : `${money(atRisk)} at risk across features`),
      r("owners", "Owners", below === undefined ? null : `${below} owners below threshold`),
      r("exec", "Executive summary", d ? (d.narrative ? d.narrative.split(/(?<=\.)\s/)[0].replace(/\.$/, "") : "Readiness, risk and owners on one page") : null),
      r("forecast", "Forecast", "Where each module score is heading"),
      r("duplicates", "Duplicates", "Which clusters to merge first"),
      r("operations", "Operations", "Job health and queue depth"),
      r("lineage", "Lineage", "Which fields feed which guards"),
      r("mining", "Mining", "Relationships, patterns and anomalies"),
      r("process", "Process", "Which business processes are ready"),
      r("reports", "Reports", "Scheduled and saved reports"),
    ].sort((a, b) => a.rank - b.rank);
  }, [d]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Insight", accessorKey: "name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { id: "headline", header: "Headline", accessorKey: "headline", enableSorting: false, cell: ({ row }) => (row.original.headline === null ? <Skeleton width={200} height={14} /> : row.original.headline) },
      { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => (row.original.status ? <Pill tone={row.original.status.tone}>{row.original.status.label}</Pill> : <span aria-label="No status">—</span>) },
      { id: "updated", header: "Updated", enableSorting: false, cell: () => (runs.isLoading ? <Skeleton width={60} height={14} /> : updated) },
    ],
    [runs.isLoading, updated],
  );

  const empty = !loading && !exec.isError && dayOne.status !== "loading" && !d?.version_id;

  return (
    <InsightFrame
      title="Insights"
      meta={run ? `${run.label || "Latest run"} · updated ${updated}` : undefined}
      state={exec.isError ? "error" : empty ? "empty" : undefined}
      emptyProps={{
        title: "No insights yet",
        detail: "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: "Could not load insights", onRetry: () => void exec.refetch() }}
    >
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-px">
          <Skeleton height={36} />
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} height={36} />)}
        </div>
      ) : (
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
      )}
    </InsightFrame>
  );
}
