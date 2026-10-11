// frontend/app/(app)/runs/page.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, ExportMenu, emptyExportOptions, Mono, Pill, Sparkline, Stat, type PillTone } from "@/design";
import { NumLink } from "@/components/num-link";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { useUrlState } from "@/hooks/use-url-state";
import { errorText } from "@/lib/api/remediation";
import { getSystems } from "@/lib/api/connectivity";
import { exportRuns } from "@/lib/api/v1/runs";
import { getVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { overallDqs, previousRunId, runSeries } from "@/lib/runs";
import type { Version } from "@/types/api";
import { isListFailure } from "@/lib/error";

const STATUS_TONE: Record<string, PillTone> = {
  failed: "no-go",
  agents_failed: "no-go",
  complete: "go",
  agents_complete: "go",
  ai_enriched: "go",
};
const statusTone = (status: string): PillTone => STATUS_TONE[status] ?? "at-risk";

function makeColumns(systemName: Map<string, string>, allVersions: Version[]): ColumnDef<Version>[] {
  return [
    { id: "label", accessorFn: (v) => v.label ?? v.id, header: "Run", cell: ({ row }) => (row.original.label ? row.original.label : <Mono>{row.original.id}</Mono>) },
    {
      id: "status",
      accessorFn: (v) => v.status,
      header: "Status",
      cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
    },
    { id: "run_at", accessorFn: (v) => v.run_at, header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    { id: "system", accessorFn: (v) => systemName.get(v.metadata?.system_id ?? "") ?? "—", header: "System" },
    { id: "modules", accessorFn: (v) => (v.metadata?.modules ?? []).map(formatModuleName).join(", "), header: "Modules" },
    {
      id: "dqs",
      accessorFn: (v) => overallDqs(v) ?? -1,
      header: "DQS",
      cell: ({ row }) => {
        const dqs = overallDqs(row.original);
        return dqs === null ? "—" : <NumLink href={`/runs/${row.original.id}`}>{dqs.toFixed(1)}</NumLink>;
      },
    },
    {
      id: "compare",
      header: "Compare",
      cell: ({ row }) => {
        const prevId = previousRunId(row.original, allVersions);
        if (!prevId) {
          return (
            <Button variant="secondary" aria-disabled="true" onClick={(e) => e.stopPropagation()}>
              Compare
            </Button>
          );
        }
        return (
          <Button
            variant="secondary"
            render={<Link href={`/runs/${row.original.id}/vs/${prevId}`} onClick={(e) => e.stopPropagation()} />}
          >
            Compare
          </Button>
        );
      },
    },
  ];
}

function scopeName(scope: string, systemName: Map<string, string>): string {
  return scope === "upload" ? "Imported files" : (systemName.get(scope) ?? scope);
}

export default function RunsPage() {
  const router = useRouter();
  const [system, setSystem] = useUrlState("system");
  const dayOne = useDayOne();

  const all = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions({ limit: 100 }) });
  const filtered = useQuery({
    queryKey: queryKeys.versionsList({ system_id: system }),
    queryFn: () => getVersions({ system_id: system, limit: 100 }),
    enabled: system !== "",
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const allVersions = useMemo(() => all.data?.versions ?? [], [all.data]);
  const columns = useMemo(() => makeColumns(systemName, allVersions), [systemName, allVersions]);
  // The upload scope has no system_id to filter by (the API has no "no system" filter), so it is not clickable here.
  const series = useMemo(() => runSeries(allVersions).filter((s) => s.scope !== "upload"), [allVersions]);
  const rows = system ? filtered.data?.versions ?? [] : allVersions;
  const activeQuery = system ? filtered : all;

  const state = activeQuery.isLoading ? "loading" : isListFailure(activeQuery) ? "error" : rows.length === 0 ? "empty" : undefined;

  const latest = rows[0];
  const latestDqs = latest ? overallDqs(latest) : null;
  const prevId = latest ? previousRunId(latest, allVersions) : null;
  const prevDqs = prevId ? overallDqs(allVersions.find((v) => v.id === prevId) ?? latest) : null;
  const delta = latestDqs !== null && prevDqs !== null ? latestDqs - prevDqs : null;
  const summary = rows.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        <Stat label="Runs" value={rows.length} />
        <Stat
          label="Latest DQS"
          value={latest && latestDqs !== null ? <NumLink href={`/runs/${latest.id}`}>{latestDqs.toFixed(1)}</NumLink> : "—"}
          hint={delta !== null && prevId ? <NumLink href={`/runs/${latest.id}/vs/${prevId}`}>{`${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs previous`}</NumLink> : "No earlier run to compare with"}
        />
        <Stat label="Failed" value={rows.filter((v) => statusTone(v.status) === "no-go").length} tone={rows.some((v) => statusTone(v.status) === "no-go") ? "no-go" : undefined} />
      </div>
      {series.length > 0 && (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => {
        const active = system === s.scope;
        return (
          <button
            key={s.scope}
            type="button"
            onClick={() => setSystem(s.scope)}
            className="flex items-center gap-2 rounded border px-2 py-1 text-[13px]"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
          >
            <span>{scopeName(s.scope, systemName)}</span>
            <Sparkline data={s.points} />
            {active ? <Pill tone="go">Filtered</Pill> : null}
          </button>
        );
      })}
      {system ? <Button variant="ghost" onClick={() => setSystem("")}>Show all</Button> : null}
    </div>
      )}
    </div>
  );

  const exportOptions = [{ format: "xlsx" as const, run: () => exportRuns("xlsx", { system_id: system || undefined, limit: 100 }) }];

  return (
    <ExplorerPage
      toolbarEnd={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
      summary={summary}
      table={
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/runs/${row.id}`)}
          bulkActions={(selected) =>
            selected.length === 2 ? (
              <Button
                onClick={() => {
                  const [a, b] = selected;
                  const [newer, older] = a.run_at >= b.run_at ? [a, b] : [b, a];
                  router.push(`/runs/${newer.id}/vs/${older.id}`);
                }}
              >
                Compare
              </Button>
            ) : (
              <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>Select exactly two runs to compare</span>
            )
          }
        />
      }
      state={state}
      emptyProps={{
        title: "No runs yet. Run the first extraction from Systems.",
        detail: dayOne.step?.detail,
        action: <DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Connect a system" />,
        ghost: "table",
      }}
      errorProps={{ message: errorText(activeQuery.error), onRetry: () => activeQuery.refetch() }}
    />
  );
}
