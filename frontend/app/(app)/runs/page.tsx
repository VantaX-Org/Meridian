// frontend/app/(app)/runs/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Pill, Sparkline } from "@/design";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/systems";
import { getVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { overallDqs, runSeries } from "@/lib/runs";
import type { Version } from "@/types/api";

function makeColumns(systemName: Map<string, string>): ColumnDef<Version>[] {
  return [
    { id: "label", accessorFn: (v) => v.label ?? v.id, header: "Run" },
    { accessorKey: "status", header: "Status" },
    { id: "run_at", accessorFn: (v) => v.run_at, header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    { id: "system", accessorFn: (v) => systemName.get(v.metadata?.system_id ?? "") ?? "—", header: "System" },
    { id: "modules", accessorFn: (v) => (v.metadata?.modules ?? []).map(formatModuleName).join(", "), header: "Modules" },
    {
      id: "dqs",
      accessorFn: (v) => overallDqs(v) ?? -1,
      header: "DQS",
      cell: ({ row }) => {
        const dqs = overallDqs(row.original);
        return dqs === null ? "—" : <span className="tabular-nums">{dqs.toFixed(1)}</span>;
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

  const all = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const filtered = useQuery({
    queryKey: queryKeys.versionsList({ system_id: system || undefined }),
    queryFn: () => getVersions(system ? { system_id: system } : undefined),
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const columns = useMemo(() => makeColumns(systemName), [systemName]);
  const series = useMemo(() => runSeries(all.data?.versions ?? []), [all.data]);
  const rows = filtered.data?.versions ?? [];

  const state = filtered.isLoading ? "loading" : filtered.isError ? "error" : rows.length === 0 ? "empty" : undefined;

  const summary = series.length > 0 && (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => {
        const active = system === (s.scope === "upload" ? "" : s.scope);
        return (
          <button
            key={s.scope}
            type="button"
            onClick={() => setSystem(s.scope === "upload" ? "" : s.scope)}
            className="flex items-center gap-2 rounded border px-2 py-1 text-[13px]"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
          >
            <span>{scopeName(s.scope, systemName)}</span>
            <Sparkline data={s.points} />
            {active && system ? <Pill tone="go">Filtered</Pill> : null}
          </button>
        );
      })}
      {system ? <Button variant="ghost" onClick={() => setSystem("")}>Show all</Button> : null}
    </div>
  );

  return (
    <ExplorerPage
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
      emptyProps={{ title: "No runs yet. Upload a file or connect a system to start a run." }}
      errorProps={{ message: `Couldn't load runs. ${filtered.error?.message ?? ""}`.trim(), onRetry: () => filtered.refetch() }}
    />
  );
}
