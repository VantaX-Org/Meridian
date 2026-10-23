// frontend/app/(app)/runs/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader, DrillLink, Button, ConfirmDialog, DataTable, Delta, ExplorerPage, ExportMenu, emptyExportOptions, Field, Input, Line, Pager, Pill, Score, Select, Skeleton, Sparkline, Stat, StatSkeleton, Tooltip, usePrefetch, type CellMeta, Status, toLifecycle, ProgressFill } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { errorText } from "@/lib/api/remediation";
import { getSystems } from "@/lib/api/connectivity";
import { exportRuns } from "@/lib/api/v1/runs";
import { blockedReasonOf, deleteVersion } from "@/lib/api/retention";
import { getAnalysisStatus } from "@/lib/api/upload";
import { archiveVersions, compareVersions, getVersions, restoreVersions } from "@/lib/api/versions";
import { formatDate, runAxisLabels } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { isFinished, lineageSeries, overallDqs, previousRunId, runPageHref, scopeOf } from "@/lib/runs";
import type { Version } from "@/types/api";
import { isListFailure } from "@/lib/error";


const runName = (v: Version) => v.label ?? formatDate(v.run_at, "datetime");
const IN_PROGRESS = new Set(["pending", "running", "agents_enqueued", "agents_running"]);

/** Live progress for a run that is still being analysed: polls the status endpoint until it settles, then refreshes the list. */
function RunRowProgress({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...queryKeys.run(id), "status"],
    queryFn: () => getAnalysisStatus(id),
    retry: false,
    refetchInterval: (query) => (query.state.data && query.state.data.status !== "queued" && query.state.data.status !== "processing" ? false : 2500),
  });
  const status = q.data?.status;
  useEffect(() => {
    if (status === "completed" || status === "failed") void qc.invalidateQueries({ queryKey: ["run"] });
  }, [status, qc]);
  if (!q.data || (status !== "queued" && status !== "processing")) return null;
  const p = q.data.progress;
  const pct = Math.min(100, Math.max(0, Math.round(p?.percent_complete ?? 0)));
  const detail = status === "queued" ? "Queued" : p?.current_step ?? "Running";
  return (
    <span className="inline-flex items-center gap-2" title={p?.total_rows ? `${p.rows_processed.toLocaleString()} of ${p.total_rows.toLocaleString()} rows` : undefined}>
      <span role="progressbar" aria-label={`${detail} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="[width:64px] [height:4px] [border-radius:var(--m-radius-pill)] [background:var(--m-sheet-sunken)] [overflow:hidden]">
        <ProgressFill value={pct} animate />
      </span>
      <span className="m-text-meta m-numeric m-ink-3">{pct}% {detail}</span>
    </span>
  );
}

/** The value the user must type to purge a run: its label, or its id when it has none (api/routes/retention.py). */
const confirmValueOf = (v: Version) => v.label ?? v.id;

/** The day a run started, as the ledger prints it (the shared date formatter, so it follows the viewer's time zone). */
const dayLabel = (v: Version) => formatDate(v.run_at, "date");

/** A severity count with its change from the previous run of the lineage: fewer failing rules is the good direction. */
function severityCell(v: Version, all: Version[], key: "critical" | "high") {
  const n = v.severity_counts?.[key];
  if (n == null) return "—";
  const prev = all.find((r) => r.id === previousRunId(v, all))?.severity_counts?.[key];
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span>{n.toLocaleString()}</span>
      {prev != null && prev !== n ? <Delta value={n - prev} invert /> : null}
    </span>
  );
}

function makeColumns(allVersions: Version[], onDelete?: (v: Version) => void): ColumnDef<Version>[] {
  return [
    {
      // The ledger is grouped by day: the label sits on the first run of each day and is blank under it.
      id: "day",
      accessorFn: (v) => v.run_at,
      header: "Day",
      size: 120,
      enableSorting: false,
      cell: ({ row, table }) => {
        const rows = table.getRowModel().rows;
        const at = rows.findIndex((r) => r.id === row.id);
        const prev = at > 0 ? rows[at - 1].original : null;
        return prev && dayLabel(prev) === dayLabel(row.original) ? null : <span className="m-ink-2 whitespace-nowrap">{dayLabel(row.original)}</span>;
      },
    },
    {
      id: "label",
      accessorFn: runName,
      header: "Run",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2" title={formatDate(row.original.run_at, "datetime")}>
          <span>{runName(row.original)}</span>
          {row.original.metadata?.baseline === true ? <Pill>Baseline</Pill> : null}
          {row.original.metadata?.archived ? <Pill>Archived</Pill> : null}
        </span>
      ),
    },
    {
      id: "lineage",
      header: "Lineage",
      size: 110,
      enableSorting: false,
      cell: ({ row }) => {
        const series = lineageSeries(row.original, allVersions);
        return series.length > 1 ? <Sparkline data={series} width={88} height={22} /> : <span className="m-ink-3">—</span>;
      },
    },
    {
      id: "status",
      accessorFn: (v) => v.status,
      header: "Status",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <Status kind="lifecycle" value={row.original.status} />
          {IN_PROGRESS.has(row.original.status) ? <RunRowProgress id={row.original.id} /> : null}
        </span>
      ),
    },
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
            <Score value={dqs} size="sm"><DrillLink href={`/runs/${row.original.id}`}>{dqs.toFixed(1)}</DrillLink></Score>
            {before !== null ? <Delta value={Math.round((dqs - before) * 10) / 10} /> : null}
          </span>
        );
      },
    },
    { id: "critical", accessorFn: (v) => v.severity_counts?.critical ?? -1, header: "Critical", size: 110, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => severityCell(row.original, allVersions, "critical") },
    { id: "high", accessorFn: (v) => v.severity_counts?.high ?? -1, header: "High", size: 100, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => severityCell(row.original, allVersions, "high") },
    {
      id: "open",
      header: "",
      size: 150,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {onDelete && row.original.metadata?.archived ? (
            <Button variant="ghost" aria-label={`Delete ${runName(row.original)} permanently`} onClick={() => onDelete(row.original)}>
              Delete permanently
            </Button>
          ) : null}
          <Link href={`/runs/${row.original.id}`} aria-label={`Open ${runName(row.original)}`} className="m-ink-accent">Open</Link>
        </span>
      ),
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
  return two ? <Button {...prefetch} onClick={() => onCompare(selected[0], selected[1])}>Compare</Button> : <span className="m-ink-2">Select two runs</span>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 m-motion-colors [background:var(--m-accent-soft)]! m-ink-accent [font-size:var(--m-text-meta)]!"
    >
      {label}
      <span aria-hidden>×</span>
    </button>
  );
}

const PAGE_SIZE = 100;

export default function RunsPage() {
  const router = useRouter();
  const [system, setSystem] = useUrlState("system");
  const [rawStatus, setStatus] = useUrlState("status", "");
  const [archivedParam, setArchived] = useUrlState("archived", "");
  const showArchived = archivedParam === "1";
  const { can } = useRole();
  const qc = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [keepLatest, setKeepLatest] = useState("1");
  const failedOnly = rawStatus === "failed";
  const dayOne = useDayOne();

  const [page, setPage] = useState(1);
  const all = useQuery({
    // Nested under the shared list's key so invalidating it refreshes this page too, but never the same key:
    // the shared list holds the paginated newest runs (hooks/use-run-list) and must not be replaced by one page.
    queryKey: [...queryKeys.run("list"), "page", page, showArchived] as const,
    queryFn: () => getVersions({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, ...(showArchived ? { include_archived: true } : {}) }),
    placeholderData: keepPreviousData,
    // Keep the list fresh while any run on this page is still being analysed.
    refetchInterval: (query) => (query.state.data?.versions?.some((v) => IN_PROGRESS.has(v.status)) ? 5000 : false),
  });
  // Summary stats and the trend use the newest page only, whichever table page is showing. Page 1 shares the cache key above.
  const head = useQuery({
    queryKey: [...queryKeys.run("list"), "page", 1, false] as const,
    queryFn: () => getVersions({ limit: PAGE_SIZE, offset: 0 }),
    placeholderData: keepPreviousData,
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const allVersions = useMemo(() => all.data?.versions ?? [], [all.data]);
  const [deleteTarget, setDeleteTarget] = useState<Version | null>(null);
  const canPurge = can("manage_settings");
  const columns = useMemo(
    () => makeColumns(allVersions, canPurge ? setDeleteTarget : undefined),
    [allVersions, canPurge],
  );
  // The upload scope has no system_id to filter by, so only real systems are offered.
  const systemOptions = useMemo(() => {
    const ids = [...new Set(allVersions.map(scopeOf))].filter((id) => id !== "upload");
    return [{ value: "", label: "All systems" }, ...ids.map((id) => ({ value: id, label: systemName.get(id) ?? id }))];
  }, [allVersions, systemName]);
  const scoped = useMemo(() => (system ? allVersions.filter((v) => v.metadata?.system_id === system) : allVersions), [allVersions, system]);
  const headVersions = useMemo(() => head.data?.versions ?? [], [head.data]);
  const headScoped = useMemo(() => (system ? headVersions.filter((v) => v.metadata?.system_id === system) : headVersions), [headVersions, system]);
  const failedCount = headScoped.filter((v) => toLifecycle(v.status) === "failed").length;
  // Newest first, so the day groups of the ledger read top-down.
  const rows = useMemo(
    () => [...(failedOnly ? scoped.filter((v) => toLifecycle(v.status) === "failed") : scoped)].sort((a, b) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0)),
    [scoped, failedOnly],
  );

  const state = all.isLoading ? "loading" : isListFailure(all) ? "error" : rows.length === 0 ? "empty" : undefined;

  const latest = headScoped[0];
  const latestDqs = latest ? overallDqs(latest) : null;
  const prevRun = latest ? headVersions.find((v) => v.id === previousRunId(latest, headVersions)) : undefined;
  const prevDqs = prevRun ? overallDqs(prevRun) : null;
  const delta = latestDqs !== null && prevDqs !== null ? Math.round((latestDqs - prevDqs) * 10) / 10 : null;

  // Chart scope: the chosen system, else the system of the latest run.
  const chartScope = system || (latest ? scopeOf(latest) : "");
  const points = useMemo(() => {
    // Keyed by run id with a disambiguated date as the tick, so two runs on one day never merge into one point.
    const scoped = headScoped.filter((v) => isFinished(v) && scopeOf(v) === chartScope);
    const ticks = runAxisLabels(scoped);
    return scoped
      .flatMap((v) => { const y = overallDqs(v); return y === null ? [] : [{ x: v.id, label: ticks.get(v.id), y: Math.round(y * 10) / 10, runId: v.id }]; })
      .reverse();
  }, [headScoped, chartScope]);

  const exportOptions = [{ format: "xlsx" as const, run: () => exportRuns("xlsx", { system_id: system || undefined, limit: 100 }) }];
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: ["run"] });
    void qc.invalidateQueries({ queryKey: ["versions-list"] });
  };
  const archive = useMutation({
    mutationFn: () => archiveVersions(Math.max(0, Number(keepLatest) || 0)),
    onSuccess: (r) => { setArchiveOpen(false); refreshLists(); toast.success(r.archived === 0 ? "No older runs to archive." : `${r.archived} run${r.archived === 1 ? "" : "s"} archived. Show archived runs to restore them.`); },
    onError: (e) => toast.error(errorText(e)),
  });
  const restore = useMutation({
    mutationFn: restoreVersions,
    onSuccess: (r) => { refreshLists(); toast.success(r.restored === 0 ? "No archived runs." : `${r.restored} run${r.restored === 1 ? "" : "s"} restored.`); },
    onError: (e) => toast.error(errorText(e)),
  });
  const purge = useMutation({
    mutationFn: (v: Version) => deleteVersion(v.id, confirmValueOf(v)),
    onSuccess: (r, v) => {
      setDeleteTarget(null);
      refreshLists();
      void qc.invalidateQueries({ queryKey: queryKeys.purgeLog() });
      const rows = Object.values(r.rows_by_table).reduce<number>((n, x) => n + (typeof x === "number" ? x : 0), 0);
      toast.success(`${runName(v)} deleted permanently: ${rows.toLocaleString()} rows removed.`);
    },
    onError: (e) => {
      const blocked = blockedReasonOf(e);
      toast.error(blocked ? `Not deleted: ${blocked}` : errorText(e));
    },
  });
  const firstSystem = systems.data?.[0];

  const header = (
    <PageHeader
      title="Runs"
      actions={
        <>
          <ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />
          {can("analyse") ? (
            showArchived ? (
              <Tooltip label="Bring every archived run back into the lists" render={<Button variant="secondary" onClick={() => restore.mutate()} pending={restore.isPending} />}>
                Restore archived runs
              </Tooltip>
            ) : (
              <Tooltip label="Hide finished runs older than the newest ones you keep. Nothing is deleted." maxWidth={260} render={<Button variant="secondary" onClick={() => setArchiveOpen(true)} />}>
                Archive older runs
              </Tooltip>
            )
          ) : null}
          {firstSystem ? (
            <Tooltip label="Extract and check the connected system now" render={<Button render={<Link href={`/systems/${firstSystem.id}`} />} />}>
              Run analysis
            </Tooltip>
          ) : (
            <Tooltip label="Connect a system first" render={<Button aria-disabled="true" onClick={() => undefined} />}>
              Run analysis
            </Tooltip>
          )}
        </>
      }
    />
  );

  const summary = all.isLoading || head.isLoading ? (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div data-testid="runs-chart-slot" className="flex flex-col gap-1">
        <Skeleton height="var(--m-leading-section)" />
        <Skeleton height={120} />
      </div>
      <div className="m-stat-grid"><StatSkeleton /><StatSkeleton /></div>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <div data-testid="runs-chart-slot" className="flex flex-col gap-1">
        <h2 className="font-semibold m-text-h">
          {`Score per run, ${systemName.get(chartScope) ?? "latest system"}`}
        </h2>
        {points.length > 1 ? (
          <Line data={points} height={120} onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }} />
        ) : (
          <div className="flex items-center justify-center text-sm [height:120px] [background:var(--m-sheet-sunken)] m-ink-3">
            Trend appears after two runs
          </div>
        )}
      </div>
      {rows.length > 0 || headScoped.length > 0 ? (
        <div className="m-stat-grid m-motion-stagger @5xl:[grid-template-columns:repeat(2,minmax(0,360px))]">
          <Stat
            label="Latest DQS"
            help="dqs"
            value={latest && latestDqs !== null ? latestDqs.toFixed(1) : "—"}
            bar={latest && latestDqs !== null ? latestDqs : undefined}
            rule={{}}
            delta={delta !== null ? <Delta value={delta} /> : undefined}
            hint={delta === null ? "No earlier run" : "vs previous"}
            href={latest ? `/runs/${latest.id}` : undefined}
          />
          <Stat label="Runs" value={(all.data?.total ?? allVersions.length).toLocaleString()} hint={all.data?.total != null && all.data.total > headVersions.length ? `latest ${headVersions.length} used for the figures above` : undefined} />
          {failedCount > 0 ? <Stat label="Failed runs" hint={`in the latest ${PAGE_SIZE}`} value={failedCount.toLocaleString()} tone="no-go" href="/runs?status=failed" /> : null}
        </div>
      ) : null}
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="System" value={system} onValueChange={setSystem} options={systemOptions} placeholder="All systems" />
      {system ? <FilterChip label={`System: ${systemName.get(system) ?? system}`} onRemove={() => setSystem("")} /> : null}
      {failedOnly ? <FilterChip label="Status: failed" onRemove={() => setStatus("")} /> : null}
      {showArchived ? (
        <FilterChip label="Including archived" onRemove={() => setArchived("")} />
      ) : (
        <Tooltip label="Include runs that were archived" render={<Button variant="ghost" onClick={() => setArchived("1")} />}>
          Show archived
        </Tooltip>
      )}
    </div>
  );

  const compare = (a: Version, b: Version) => {
    const [newer, older] = a.run_at >= b.run_at ? [a, b] : [b, a];
    router.push(`/runs/${newer.id}/vs/${older.id}`);
  };

  return (
    <>
    <ConfirmDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      title="Delete run permanently"
      tone="danger"
      confirmLabel="Delete permanently"
      cancelLabel="Keep"
      typeToConfirm={deleteTarget ? confirmValueOf(deleteTarget) : undefined}
      pending={purge.isPending}
      onConfirm={() => { if (deleteTarget) purge.mutate(deleteTarget); }}
      body={
        <p>
          Every finding, record, profile, report and fix of this run is removed from the database and from storage. This cannot be undone. Runs with open stewardship items, unfinished cleaning or pending write-backs are refused.
        </p>
      }
    />
    <ConfirmDialog
      open={archiveOpen}
      onOpenChange={setArchiveOpen}
      title="Archive older runs"
      confirmLabel="Archive"
      pending={archive.isPending}
      onConfirm={() => archive.mutate()}
      body={
        <div className="flex flex-col gap-3">
          <p>Finished runs older than the newest ones you keep are hidden from every list. Nothing is deleted: findings, reports and history stay, and you can restore them at any time.</p>
          <Field label="Keep the newest">
            <Input type="number" min={0} max={100} value={keepLatest} onChange={(e) => setKeepLatest(e.target.value)} />
          </Field>
          <p className="m-text-meta m-ink-3">
            {all.data?.total != null
              ? `Up to ${Math.max(0, all.data.total - Math.max(0, Number(keepLatest) || 0)).toLocaleString()} of ${all.data.total.toLocaleString()} runs will be archived.`
              : "Runs older than the ones you keep will be archived."}
          </p>
        </div>
      }
    />
    <ExplorerPage
      header={header}
      filterBar={filterBar}
      summary={summary}
      table={
        <>
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          rowHref={(row) => `/runs/${row.id}`}
          onRowClick={(row) => router.push(`/runs/${row.id}`)}
          bulkActions={(selected) => <CompareBar selected={selected} onCompare={compare} />}
        />
        {(all.data?.total ?? 0) > PAGE_SIZE && (
          <Pager page={page} pageCount={Math.ceil((all.data?.total ?? 0) / PAGE_SIZE)} pageSize={PAGE_SIZE} total={all.data?.total ?? 0} onPageChange={setPage} />
        )}
        </>
      }
      state={state}
      emptyProps={
        failedOnly || system
          ? {
              title: "No runs match",
              detail: "Try removing a filter.",
              action: <Button onClick={() => { setSystem(""); setStatus(""); }}>Clear filters</Button>,
            }
          : {
              title: "No runs yet",
              detail: dayOne.step?.detail ?? "Run the first extraction from Systems.",
              action: <DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Connect a system" />,
              ghost: "table",
            }
      }
      errorProps={{ message: errorText(all.error), onRetry: () => all.refetch() }}
    />
    </>
  );
}
