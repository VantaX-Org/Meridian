// frontend/app/(app)/runs/page.tsx
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader, DrillLink, FilterChip, Button, ConfirmDialog, DataTable, Delta, EmptyState, ExplorerPage, ExportMenu, emptyExportOptions, Field, HelpHint, Input, Line, Menu, Pager, Pill, RowAction, Score, Select, Skeleton, Sparkline, Stat, StatSkeleton, Tooltip, usePrefetch, type CellMeta, Status, toLifecycle, ProgressFill } from "@/design";
import { RunAnalysis } from "@/app/(app)/insights/_components/RunAnalysis";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { errorText } from "@/lib/api/remediation";
import { getSystems } from "@/lib/api/connectivity";
import { exportRuns } from "@/lib/api/v1/runs";
import { blockedReasonOf, deleteVersion } from "@/lib/api/retention";
import { getAnalysisStatus } from "@/lib/api/upload";
import { archiveVersions, compareVersions, getVersions, restoreVersions } from "@/lib/api/versions";
import { formatDate, formatNumber, plural } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";
import { queryKeys } from "@/lib/query-keys";
import { isFinished, lineageOf, lineageSeries, overallDqs, previousRunId, runPageHref, scopeOf } from "@/lib/runs";
import { runName, runScopeLabel } from "@/lib/run-scope";
import type { Version } from "@/types/api";
import { isListFailure } from "@/lib/error";

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

/**
 * Re-runs of the same lineage and objects (the system, or uploads of the same objects): the newest finished run is
 * the ledger's row and the earlier finished ones fold under it. A run still in progress or failed keeps its own row,
 * so nothing that needs attention is folded away. Returns the rows, newest first, and each row's earlier runs.
 */
export function groupReruns(versions: readonly Version[]): { rows: Version[]; earlier: Map<string, Version[]> } {
  const keyOf = (v: Version) => `${lineageOf(v)}|${[...(v.metadata?.modules ?? Object.keys(v.dqs_summary ?? {}))].sort().join("+")}`;
  const sorted = [...versions].sort((a, b) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0));
  const head = new Map<string, Version>();
  const earlier = new Map<string, Version[]>();
  const rows: Version[] = [];
  for (const v of sorted) {
    if (!isFinished(v)) {
      rows.push(v);
      continue;
    }
    const first = head.get(keyOf(v));
    if (!first) {
      head.set(keyOf(v), v);
      rows.push(v);
      earlier.set(v.id, []);
    } else {
      earlier.get(first.id)?.push(v);
    }
  }
  return { rows, earlier };
}

/** Who or what started a run, from what the run records: a file someone imported, or a download from a system. */
export function triggeredBy(v: Version): string {
  if (v.metadata?.file_name) return "File import";
  if (v.metadata?.source === "extraction") return "System download";
  return "—";
}

function makeColumns(allVersions: Version[], earlier: ReadonlyMap<string, Version[]>, systemOf: (v: Version) => string, onDelete?: (v: Version) => void): ColumnDef<Version>[] {
  return [
    {
      // The ledger is grouped by day: the label sits on the first run of each day and is blank under it.
      id: "day",
      accessorFn: (v) => v.run_at,
      header: "Day",
      size: 120,
      meta: { priority: "low" } satisfies CellMeta,
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
      cell: ({ row }) => {
        const more = earlier.get(row.original.id)?.length ?? 0;
        return (
          // Wraps on a phone: the note drops under the name rather than running under the pinned Open.
          <span className="inline-flex flex-wrap items-center gap-x-2" title={formatDate(row.original.run_at, "datetime")}>
            <span className="min-w-0">{breakAtUnderscores(runName(row.original))}</span>
            {more > 0 ? <span className="m-text-meta m-ink-3 whitespace-nowrap">{`+${plural(more, "earlier run")}`}</span> : null}
            {row.original.metadata?.baseline === true ? <Pill>Baseline</Pill> : null}
            {row.original.metadata?.archived ? <Pill>Archived</Pill> : null}
          </span>
        );
      },
    },
    { id: "system", header: "System", meta: { priority: "low" } satisfies CellMeta, accessorFn: systemOf, cell: ({ row }) => <span className="whitespace-nowrap">{systemOf(row.original)}</span> },
    {
      id: "records", header: "Records", size: 110, meta: { numeric: true, priority: "low" } satisfies CellMeta,
      accessorFn: (v) => v.metadata?.row_count ?? -1,
      cell: ({ row }) => (row.original.metadata?.row_count != null ? formatNumber(row.original.metadata.row_count) : "—"),
    },
    { id: "triggered", header: "Triggered by", meta: { priority: "low" } satisfies CellMeta, accessorFn: triggeredBy },
    {
      id: "history",
      header: () => <span className="inline-flex items-center gap-1">History <HelpHint term="run" /></span>,
      size: 110,
      enableSorting: false,
      meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row }) => {
        const series = lineageSeries(row.original, allVersions);
        return series.length > 1 ? <Sparkline data={series} width={88} height={22} /> : <span className="m-ink-3">—</span>;
      },
    },
    {
      id: "status",
      accessorFn: (v) => v.status,
      header: "Status",
      meta: { priority: "low" } satisfies CellMeta,
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
      header: "Score",
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
    { id: "high", accessorFn: (v) => v.severity_counts?.high ?? -1, header: "High", size: 100, meta: { numeric: true, priority: "low" } satisfies CellMeta, cell: ({ row }) => severityCell(row.original, allVersions, "high") },
    {
      id: "open",
      header: "",
      size: 150,
      enableSorting: false,
      meta: { sticky: "end" } satisfies CellMeta,
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {onDelete && row.original.metadata?.archived ? (
            <Button variant="ghost" aria-label={`Delete ${runName(row.original)} permanently`} onClick={() => onDelete(row.original)}>
              Delete permanently
            </Button>
          ) : null}
          <RowAction href={`/runs/${row.original.id}`} label={`Open ${runName(row.original)}`} />
        </span>
      ),
    },
  ];
}

/** An upload name ("quality_management_1k") that may wrap after each underscore on a phone, never mid-word. */
function breakAtUnderscores(name: string): ReactNode {
  const parts = name.split("_");
  return parts.map((p, i) => (i < parts.length - 1 ? <Fragment key={i}>{p}_<wbr /></Fragment> : <Fragment key={i}>{p}</Fragment>));
}

/** The earlier runs folded under a ledger row: each with its time, status and score, a compare with the row's run, and Open. */
function EarlierRuns({ head, runs, all }: { head: Version; runs: readonly Version[]; all: Version[] }) {
  return (
    <ul className="flex flex-col" aria-label="Earlier runs">
      {runs.map((v) => {
        const dqs = overallDqs(v);
        const prev = all.find((r) => r.id === previousRunId(v, all));
        const before = prev ? overallDqs(prev) : null;
        return (
          <li key={v.id} className="flex flex-wrap items-center gap-4 border-b py-1 m-text-body [border-color:var(--m-line)]">
            <span className="m-ink-2 m-numeric [min-width:9rem]">{formatDate(v.run_at, "datetime")}</span>
            <span className="[min-width:12rem]">{runName(v)}</span>
            <Status kind="lifecycle" value={v.status} />
            <span className="inline-flex items-center gap-2 m-numeric">
              {dqs === null ? "—" : dqs.toFixed(1)}
              {dqs !== null && before !== null ? <Delta value={Math.round((dqs - before) * 10) / 10} /> : null}
            </span>
            <Link href={`/runs/${head.id}/vs/${v.id}`} className="m-ink-accent underline-offset-2 hover:underline">Compare with latest</Link>
            <RowAction href={`/runs/${v.id}`} label={`Open ${runName(v)}`} />
          </li>
        );
      })}
    </ul>
  );
}

/** Where `c` is someone else's key: a field, a control, or a dialog, listbox or menu that owns the keyboard. */
const KEY_OWNERS = "input, textarea, select, [contenteditable], a, button, [role=dialog], [role=alertdialog], [role=listbox], [role=option], [role=menu], [role=menuitem], [role=combobox]";

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
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || t?.closest(KEY_OWNERS)) return;
      onCompare(selected[0], selected[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [two, selected, onCompare]);
  return two ? <Button {...prefetch} onClick={() => onCompare(selected[0], selected[1])}>Compare</Button> : <span className="m-ink-2">Select two runs</span>;
}

const PAGE_SIZE = 100;

export default function RunsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // The page belongs to one filter set: changing a filter starts again at page 1.
  const filterKey = `${system}|${failedOnly ? "failed" : ""}|${showArchived ? "1" : ""}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (p: number) => setPaging({ key: filterKey, page: p });
  const all = useQuery({
    // Nested under the shared list's key so invalidating it refreshes this page too, but never the same key:
    // the shared list holds the paginated newest runs (hooks/use-run-list) and must not be replaced by one page.
    // System and status are filtered on the server, so `total` and the pager count the filtered set, not one page.
    queryKey: [...queryKeys.run("list"), "page", page, showArchived, system, failedOnly] as const,
    queryFn: () => getVersions({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      ...(system ? { system_id: system } : {}),
      ...(failedOnly ? { status: "failed" as const } : {}),
      ...(showArchived ? { include_archived: true } : {}),
    }),
    placeholderData: keepPreviousData,
    // Keep the list fresh while any run on this page is still being analysed.
    refetchInterval: (query) => (query.state.data?.versions?.some((v) => IN_PROGRESS.has(v.status)) ? 5000 : false),
  });
  const total = all.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Archiving or deleting can shrink the set under the current page: step back to the last page that exists.
  if (all.data && !all.isPlaceholderData && page > pageCount) setPage(pageCount);
  // Summary stats and the trend use the newest page of the chosen system, whichever table page is showing.
  // Unfiltered, page 1 shares the cache key above.
  const head = useQuery({
    queryKey: [...queryKeys.run("list"), "page", 1, false, system, false] as const,
    queryFn: () => getVersions({ limit: PAGE_SIZE, offset: 0, ...(system ? { system_id: system } : {}) }),
    placeholderData: keepPreviousData,
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const allVersions = useMemo(() => all.data?.versions ?? [], [all.data]);
  const [deleteTarget, setDeleteTarget] = useState<Version | null>(null);
  const canPurge = can("manage_settings");
  // Re-runs of one lineage and object set fold under the newest (expand the row to see them).
  const grouped = useMemo(() => groupReruns(allVersions), [allVersions]);
  const systemOf = useCallback((v: Version) => (scopeOf(v) === "upload" ? "Upload" : systemName.get(scopeOf(v)) ?? "—"), [systemName]);
  const columns = useMemo(
    () => makeColumns(allVersions, grouped.earlier, systemOf, canPurge ? setDeleteTarget : undefined),
    [allVersions, grouped, systemOf, canPurge],
  );
  // Every connected system, not only the ones on the current page. The upload scope has no system_id to filter by.
  const systemOptions = useMemo(
    () => [{ value: "", label: "All systems" }, ...(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))],
    [systems.data],
  );
  // The server already scoped both lists to the chosen system.
  const headScoped = useMemo(() => head.data?.versions ?? [], [head.data]);
  const headVersions = headScoped;
  const failedCount = headScoped.filter((v) => toLifecycle(v.status) === "failed").length;
  // Newest first, so the day groups of the ledger read top-down; one row per lineage and object set.
  const rows = grouped.rows;

  // Empty only when the filtered set is: a page past the end steps back above instead of reading as "No runs match".
  const state = all.isLoading ? "loading" : isListFailure(all) ? "error" : rows.length === 0 && total === 0 ? "empty" : undefined;

  const latest = headScoped[0];
  const latestDqs = latest ? overallDqs(latest) : null;
  const prevRun = latest ? headVersions.find((v) => v.id === previousRunId(latest, headVersions)) : undefined;
  const prevDqs = prevRun ? overallDqs(prevRun) : null;
  const delta = latestDqs !== null && prevDqs !== null ? Math.round((latestDqs - prevDqs) * 10) / 10 : null;

  // Chart scope: the chosen system, else the system of the latest run.
  const chartScope = system || (latest ? scopeOf(latest) : "");
  // The name of a scope: the system's name, "uploads" for imported files; null until the systems load.
  const scopeName = (scope: string): string | null => (scope === "upload" ? "uploads" : systemName.get(scope) ?? null);
  const chartScopeName = chartScope ? scopeName(chartScope) : null;
  const latestScopeName = latest ? scopeName(scopeOf(latest)) : null;
  const points = useMemo(() => {
    // Keyed by run id with a disambiguated date as the tick, so two runs on one day never merge into one point.
    const scoped = headScoped.filter((v) => isFinished(v) && scopeOf(v) === chartScope);
    const ticks = runAxisTicks(scoped);
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
  // Runs stands on its own (no view tabs: it is in the index bar). Run analysis is the one primary action and Export the one
  // secondary; Review fixes, Present and archiving wait in "More". The run count is the header meta, not a tile.
  const runTotal = all.data?.total ?? allVersions.length;
  const presenting = searchParams?.get("present") === "1";
  const presentHref = `/runs?${new URLSearchParams({ ...Object.fromEntries(searchParams?.entries() ?? []), present: "1" })}`;
  // The other ways to start a run sit beside Run analysis: import a file, run process discovery.
  const moreItems = [
    ...(can("upload") ? [{ label: "Import a file", onSelect: () => router.push("/import") }] : []),
    ...(can("run_process_discovery") ? [{ label: "Run process discovery", onSelect: () => router.push("/process/runs?new=1") }] : []),
    { label: "Review fixes", onSelect: () => router.push("/fix") },
    { label: "Present", onSelect: () => router.push(presentHref) },
    ...(can("analyse")
      ? [showArchived
        ? { label: "Restore archived runs", onSelect: () => restore.mutate() }
        : { label: "Archive older runs", onSelect: () => setArchiveOpen(true) }]
      : []),
  ];
  const header = (
    <PageHeader
      title="Runs"
      meta={
        <span data-testid="runs-meta" className="inline-flex items-center gap-1">
          {all.isLoading || runTotal === 0 ? "Every analysis" : plural(runTotal, "run")}, newest first; change is against the previous run of the same system <HelpHint term="previous_run" />
        </span>
      }
      actions={presenting ? undefined : (
        <>
          <Menu trigger={<Button variant="ghost" pending={restore.isPending}>More</Button>} items={moreItems} />
          <ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />
          <RunAnalysis variant="primary" />
        </>
      )}
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
          {chartScopeName ? `Score per run, ${chartScopeName}` : "Score per run"}
        </h2>
        {points.length > 1 ? (
          <Line data={points} height={120} onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }} />
        ) : (
          <div className="flex items-center justify-center [height:120px] [background:var(--m-sheet-sunken)]">
            <EmptyState variant="inline" title="Trend appears after two runs" />
          </div>
        )}
      </div>
      {rows.length > 0 || headScoped.length > 0 ? (
        // As many columns as tiles, so one tile never stretches across the row.
        <div className={`m-stat-grid m-motion-stagger ${failedCount > 0 ? "@5xl:[grid-template-columns:repeat(2,minmax(0,360px))]" : "[grid-template-columns:minmax(0,360px)]"}`}>
          <Stat
            label={latestScopeName ? `Latest DQS, ${latestScopeName}` : "Latest DQS"}
            help="dqs"
            value={latest && latestDqs !== null ? latestDqs.toFixed(1) : "—"}
            bar={latest && latestDqs !== null ? latestDqs : undefined}
            rule={{}}
            delta={delta !== null ? <Delta value={delta} /> : undefined}
            hint={!latest ? "No earlier run" : delta === null ? `${runScopeLabel(latest)}, mean of ${plural(Object.keys(latest.dqs_summary ?? {}).length, "object")}` : `${runScopeLabel(latest)}, vs previous run`}
            href={latest ? `/runs/${latest.id}` : undefined}
          />
          {failedCount > 0 ? <Stat label="Failed runs" hint={`in the latest ${PAGE_SIZE}`} value={failedCount.toLocaleString()} tone="no-go" href="/runs?status=failed" /> : null}
        </div>
      ) : null}
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="System" value={system} onValueChange={setSystem} options={systemOptions} placeholder="All systems" />
      {system ? <FilterChip label="System" value={systemName.get(system) ?? system} onRemove={() => setSystem("")} /> : null}
      {failedOnly ? <FilterChip label="Status" value="Failed" onRemove={() => setStatus("")} /> : null}
      {showArchived ? (
        <FilterChip label="Runs" value="Including archived" onRemove={() => setArchived("")} />
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
          canExpand={(row) => (grouped.earlier.get(row.id)?.length ?? 0) > 0}
          renderExpanded={(row) => <EarlierRuns head={row} runs={grouped.earlier.get(row.id) ?? []} all={allVersions} />}
        />
        {total > PAGE_SIZE && (
          <Pager page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
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
