// frontend/app/(app)/runs/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader, DrillLink, Button, DataTable, Delta, ExplorerPage, ExportMenu, emptyExportOptions, Line, Pill, Select, Stat, usePrefetch, type PillTone } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { useUrlState } from "@/hooks/use-url-state";
import { errorText } from "@/lib/api/remediation";
import { getSystems } from "@/lib/api/connectivity";
import { exportRuns } from "@/lib/api/v1/runs";
import { compareVersions, getVersions } from "@/lib/api/versions";
import { formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { overallDqs, previousRunId, scopeOf } from "@/lib/runs";
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

const runName = (v: Version) => v.label ?? formatDate(v.run_at, "datetime");

function makeColumns(systemName: Map<string, string>, allVersions: Version[]): ColumnDef<Version>[] {
  return [
    { id: "label", accessorFn: runName, header: "Run" },
    {
      id: "status",
      accessorFn: (v) => v.status,
      header: "Status",
      cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
    },
    { id: "run_at", accessorFn: (v) => v.run_at, header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    { id: "system", accessorFn: (v) => systemName.get(v.metadata?.system_id ?? "") ?? "—", header: "System" },
    { id: "objects", accessorFn: (v) => v.metadata?.modules?.length ?? 0, header: "Objects" },
    {
      id: "dqs",
      accessorFn: (v) => overallDqs(v) ?? -1,
      header: "DQS",
      cell: ({ row }) => {
        const dqs = overallDqs(row.original);
        if (dqs === null) return "—";
        const prev = allVersions.find((r) => r.id === previousRunId(row.original, allVersions));
        const before = prev ? overallDqs(prev) : null;
        return (
          <span className="inline-flex items-center gap-2">
            <DrillLink href={`/runs/${row.original.id}`}>{dqs.toFixed(1)}</DrillLink>
            {before !== null ? <Delta value={Math.round((dqs - before) * 10) / 10} /> : null}
          </span>
        );
      },
    },
    {
      id: "baseline",
      header: "Baseline",
      accessorFn: (v) => (v.metadata?.baseline === true ? "Baseline" : ""),
      cell: ({ row }) => (row.original.metadata?.baseline === true ? <Pill>Baseline</Pill> : null),
    },
  ];
}

/** Bulk bar for the selection; `c` compares once exactly two runs are selected. */
function CompareBar({ selected, onCompare }: { selected: Version[]; onCompare: (a: Version, b: Version) => void }) {
  const two = selected.length === 2;
  const [newer, older] = two && selected[0].run_at < selected[1].run_at ? [selected[1], selected[0]] : [selected[0], selected[1]];
  const prefetch = usePrefetch(
    two ? `/runs/${newer.id}/vs/${older.id}` : undefined,
    two ? [...queryKeys.runCompare(newer.id, older.id), "modules", undefined] : undefined,
    () => compareVersions(older.id, newer.id, undefined),
  );
  useEffect(() => {
    if (!two) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      onCompare(selected[0], selected[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [two, selected, onCompare]);
  return two ? <Button {...prefetch} onClick={() => onCompare(selected[0], selected[1])}>Compare</Button> : <span style={{ color: "var(--m-ink-2)" }}>Select two runs</span>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 m-motion-colors"
      style={{ background: "var(--m-accent-soft)", color: "var(--m-accent)", fontSize: "var(--m-text-meta)" }}
    >
      {label}
      <span aria-hidden>×</span>
    </button>
  );
}

export default function RunsPage() {
  const router = useRouter();
  const [system, setSystem] = useUrlState("system");
  const [rawStatus, setStatus] = useUrlState("status", "");
  const failedOnly = rawStatus === "failed";
  const dayOne = useDayOne();

  const all = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions({ limit: 100 }) });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const allVersions = useMemo(() => all.data?.versions ?? [], [all.data]);
  const columns = useMemo(() => makeColumns(systemName, allVersions), [systemName, allVersions]);
  // The upload scope has no system_id to filter by, so only real systems are offered.
  const systemOptions = useMemo(() => {
    const ids = [...new Set(allVersions.map(scopeOf))].filter((id) => id !== "upload");
    return [{ value: "", label: "All systems" }, ...ids.map((id) => ({ value: id, label: systemName.get(id) ?? id }))];
  }, [allVersions, systemName]);
  const scoped = useMemo(() => (system ? allVersions.filter((v) => v.metadata?.system_id === system) : allVersions), [allVersions, system]);
  const failedCount = scoped.filter((v) => statusTone(v.status) === "no-go").length;
  const rows = failedOnly ? scoped.filter((v) => statusTone(v.status) === "no-go") : scoped;

  const state = all.isLoading ? "loading" : isListFailure(all) ? "error" : rows.length === 0 ? "empty" : undefined;

  const latest = scoped[0];
  const latestDqs = latest ? overallDqs(latest) : null;
  const prevRun = latest ? allVersions.find((v) => v.id === previousRunId(latest, allVersions)) : undefined;
  const prevDqs = prevRun ? overallDqs(prevRun) : null;
  const delta = latestDqs !== null && prevDqs !== null ? Math.round((latestDqs - prevDqs) * 10) / 10 : null;

  // Chart scope: the chosen system, else the system of the latest run.
  const chartScope = system || (latest ? scopeOf(latest) : "");
  const points = useMemo(
    () =>
      scoped
        .filter((v) => v.status === "complete" && scopeOf(v) === chartScope)
        .flatMap((v) => { const y = overallDqs(v); return y === null ? [] : [{ x: formatDate(v.run_at, "date"), y: Math.round(y * 10) / 10, runId: v.id }]; })
        .reverse(),
    [scoped, chartScope],
  );

  const exportOptions = [{ format: "xlsx" as const, run: () => exportRuns("xlsx", { system_id: system || undefined, limit: 100 }) }];
  const firstSystem = systems.data?.[0];

  const header = (
    <PageHeader
      title="Runs"
      actions={
        <>
          <ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />
          {firstSystem ? (
            <Button render={<Link href={`/systems/${firstSystem.id}`}>Run analysis</Link>} />
          ) : (
            <Button disabled title="Connect a system first">Run analysis</Button>
          )}
        </>
      }
    />
  );

  const summary = (
    <div className="flex flex-col gap-4">
      {rows.length > 0 || scoped.length > 0 ? (
        <div className="flex flex-wrap gap-6">
          <Stat
            label="Latest DQS"
            value={latest && latestDqs !== null ? latestDqs.toFixed(1) : "—"}
            delta={delta !== null ? <Delta value={delta} /> : undefined}
            hint={delta === null ? "No earlier run" : "vs previous"}
            href={latest ? `/runs/${latest.id}` : undefined}
          />
          {failedCount > 0 ? <Stat label="Failed runs" value={failedCount.toLocaleString()} tone="no-go" href="/runs?status=failed" /> : null}
        </div>
      ) : null}
      {points.length > 1 ? (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold" style={{ fontSize: "var(--m-text-section)", lineHeight: "var(--m-leading-section)" }}>
            {`Score per run, ${systemName.get(chartScope) ?? "latest system"}`}
          </h2>
          <Line data={points} height={160} onPointClick={(p) => p.runId && router.push(`/runs/${p.runId}`)} />
        </div>
      ) : null}
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="System" value={system} onValueChange={setSystem} options={systemOptions} placeholder="All systems" />
      {system ? <FilterChip label={`System: ${systemName.get(system) ?? system}`} onRemove={() => setSystem("")} /> : null}
      {failedOnly ? <FilterChip label="Status: failed" onRemove={() => setStatus("")} /> : null}
    </div>
  );

  const compare = (a: Version, b: Version) => {
    const [newer, older] = a.run_at >= b.run_at ? [a, b] : [b, a];
    router.push(`/runs/${newer.id}/vs/${older.id}`);
  };

  return (
    <ExplorerPage
      header={header}
      filterBar={filterBar}
      summary={summary}
      table={
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          rowHref={(row) => `/runs/${row.id}`}
          onRowClick={(row) => router.push(`/runs/${row.id}`)}
          bulkActions={(selected) => <CompareBar selected={selected} onCompare={compare} />}
        />
      }
      state={state}
      emptyProps={{
        title: "No runs yet",
        detail: dayOne.step?.detail ?? "Run the first extraction from Systems.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Connect a system" />,
        ghost: "table",
      }}
      errorProps={{ message: errorText(all.error), onRetry: () => all.refetch() }}
    />
  );
}
