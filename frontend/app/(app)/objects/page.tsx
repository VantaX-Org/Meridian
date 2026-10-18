// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DomainChip, useBreadcrumbScope, DrillLink, ExplorerPage, ExportMenu, Mono, PageHeader, Sparkline, Stat, emptyExportOptions, type CellMeta, type ScoreBands, Status, Score } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { getVersion } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { barFill } from "@/design/table/columns";
import { DIMENSIONS } from "@/lib/home-metrics";
import { stateScopeLine } from "@/lib/current-state";
import { formatModuleName } from "@/lib/format";
import { bySeverity } from "../_severity-sort";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun } from "@/lib/run-scope";
import { FilterChips } from "./_header";
import { useCurrentObjects } from "./_current";
import { clsx } from "clsx";

/**
 * A row of the list. With `?run=` every row is that run's; without it (the current state) each row is its object
 * at its own latest run, and links to the object without `?run=` (the object page opens that run itself).
 * `affected_records` is null only when a current-state row's run could not be read and its records not attributed.
 */
type ObjectRow = Omit<ObjectSummary, "affected_records"> & { affected_records: number | null; run_id?: string };

/** Number cells drill to the object's rules tab; `run` undefined drills to the object's own latest run. */
const drill = (o: ObjectRow, run: string | undefined, n: number | string) => (
  <DrillLink object={o.module} run={run === "latest" ? undefined : run} filters={{ tab: "rules" }}>{n}</DrillLink>
);

const RANK: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
/** Worst readiness first, then DQS ascending; unscored objects last. */
const worstFirst = (a: ObjectRow, b: ObjectRow) =>
  (RANK[a.readiness ?? ""] ?? 3) - (RANK[b.readiness ?? ""] ?? 3) || (a.composite_score ?? 101) - (b.composite_score ?? 101);

const READINESS_FILTER = [
  { value: "fail", label: "No-go" },
  { value: "warn", label: "At risk" },
  { value: "pass", label: "Go" },
] as const;
type ReadinessFilter = (typeof READINESS_FILTER)[number]["value"];
/** `?verdict=` is the legacy form of `?readiness=` (ready means pass; not_ready has no equivalent and is ignored). */
const LEGACY_VERDICT: Record<string, ReadinessFilter> = { ready: "pass" };

/** Optional enrichment columns appear only when some row carries the field (older backends omit them). */
const makeColumns = (run: string | undefined, bands: ScoreBands | undefined, objects: ObjectRow[]): ColumnDef<ObjectRow>[] => {
  const hasTrend = objects.some((o) => (o.trend?.length ?? 0) >= 2);
  const hasBlocking = objects.some((o) => o.blocking_rule_id);
  const hasSev = objects.some((o) => o.critical_checks != null);
  const hasDims = objects.some((o) => o.dimension_scores && Object.keys(o.dimension_scores).length > 0);
  return allColumns(run, bands).filter((c) => (c.id !== "trend" || hasTrend) && (c.id !== "blocking_rule" || hasBlocking) && (c.id !== "dimensions" || hasDims) && ((c.id !== "critical" && c.id !== "high") || hasSev));
};

const allColumns = (run: string | undefined, bands: ScoreBands | undefined): ColumnDef<ObjectRow>[] => [
  { accessorKey: "label", header: "Object", cell: ({ row }) => <DomainChip moduleId={row.original.module} label={row.original.label} /> },
  {
    accessorKey: "composite_score",
    header: "DQS",
    cell: ({ row }) => {
      const score = row.original.composite_score;
      if (score == null) return "—";
      return (
        <Score size="sm" value={score} bands={bands}>{drill(row.original, run, score)}</Score>
      );
    },
  },
  {
    id: "readiness",
    // Severity-mapped value drives the row bar; the cell still shows the verdict word.
    accessorFn: (o) => (o.readiness === "fail" ? "critical" : o.readiness === "warn" ? "medium" : o.readiness === "pass" ? "pass" : ""),
    header: "Readiness",
    sortingFn: bySeverity,
    meta: { severity: true } satisfies CellMeta,
    cell: ({ row }) => {
      const readiness = row.original.readiness;
      if (!readiness) return "—";
      return <Status kind="verdict" value={readiness} variant="solid" />;
    },
  },
  {
    id: "dimensions",
    header: "Dimensions",
    enableSorting: false,
    size: 96,
    cell: ({ row }) => {
      const scores = row.original.dimension_scores ?? {};
      return (
        <span className="inline-flex items-center gap-0.5" role="img" aria-label={DIMENSIONS.map((d) => `${formatModuleName(d)} ${scores[d] === undefined ? "not measured" : scores[d].toFixed(0)}`).join(", ")}>
          {DIMENSIONS.map((d) => {
            const v = scores[d];
            return <span key={d} {...(v === undefined ? {} : barFill(v, { max: 100, tone: "rate" })?.attr)} className={clsx("m-bar-fill [width:10px] [height:14px] [border-radius:2px]", v === undefined && "[background:var(--m-line)]!")} />;
          })}
        </span>
      );
    },
  },
  {
    id: "trend",
    header: "Trend",
    size: 96,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => {
      const t = row.original.trend;
      return t && t.length >= 2 ? <Sparkline data={t.map((y, x) => ({ x, y }))} /> : "—";
    },
  },
  {
    id: "blocking_rule",
    header: "Blocking rule",
    cell: ({ row }) => {
      const id = row.original.blocking_rule_id;
      if (!id) return "—";
      return (
        <DrillLink href={`/objects/${row.original.module}?${run ? `run=${run}&` : ""}tab=records&check_id=${encodeURIComponent(id)}`}>
          <Mono>{id}</Mono>
        </DrillLink>
      );
    },
  },
  { id: "critical", accessorFn: (o) => o.critical_checks ?? -1, header: "Critical", size: 90, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => (row.original.critical_checks == null ? "—" : drill(row.original, run, row.original.critical_checks)) },
  { id: "high", accessorFn: (o) => o.high_checks ?? -1, header: "High", size: 80, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => (row.original.high_checks == null ? "—" : drill(row.original, run, row.original.high_checks)) },
  { accessorKey: "failing_checks", header: "Failing checks", size: 120, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => drill(row.original, run, row.original.failing_checks) },
  {
    id: "affected_records",
    accessorFn: (o) => o.affected_records ?? -1,
    header: "Affected records",
    size: 130,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => (row.original.affected_records == null ? "—" : drill(row.original, run, row.original.affected_records.toLocaleString())),
  },
];

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  // With ?run= the list is that one run; without it, the current state: every object at its own latest run.
  const explicitRun = search.get("run");
  const run = explicitRun ?? "latest";
  const current = explicitRun == null;
  const dayOne = useDayOne();
  // Ruling 7: objects outside a module-scoped user's grants are hidden (UI filter; the API enforces scope).
  const { scopeFilter } = usePermissions();

  const single = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
    enabled: !current,
  });
  const currentQ = useCurrentObjects(current, scopeFilter.modules);
  const data = single.data;
  // Detail links carry the resolved run id so list and detail share one cache key.
  const runId = current ? undefined : data?.run_id ?? (run === "latest" ? undefined : run);

  const { data: version } = useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => getVersion(runId ?? ""),
    enabled: !!runId,
  });

  const objects: ObjectRow[] = current
    ? currentQ.rows
    : (data?.objects ?? []).filter((o) => !scopeFilter.modules || scopeFilter.modules.has(o.module));
  const isLoading = current ? currentQ.isLoading : single.isLoading;
  const query = current ? { isError: currentQ.isError, error: currentQ.error } : { isError: single.isError, error: single.error };
  const refetch = current ? currentQ.refetch : () => void single.refetch();
  const loaded = current ? !currentQ.isLoading && !currentQ.isError : !!data;
  const newest = currentQ.runs[0];

  useBreadcrumbScope(loaded ? [`${objects.length} ${objects.length === 1 ? "object" : "objects"}`] : []);
  // The header names the run the list belongs to; a ?run= other than the newest finished run offers "Back to latest".
  const { latestId } = useRunScope();
  const runScope = { run: version, choices: [], latestId, pinned: run !== "latest" && !!latestId && run !== latestId };

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode; ghost?: "table" } = { title: "No objects in this run", ghost: "table" };
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure(query)) {
    state = "error";
  } else if (loaded && objects.length === 0) {
    state = "empty";
    const anyRun = current ? !!newest : !!data?.run_id;
    emptyProps = {
      title: anyRun ? (current ? "No objects measured" : "No objects in this run") : "No objects measured yet",
      detail: anyRun ? "Run an analysis on a connected system." : dayOne.step?.detail ?? "Run an extraction to analyse your first objects.",
      action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      ghost: "table",
    };
  }

  // The export and the report are per run: without ?run= they are the newest finished run's, and say so.
  const reportRun = current ? newest?.id : data?.run_id; // no run yet: there is no report to download
  const exportOptions = [
    { format: "xlsx" as const, label: current ? "Newest run's objects (.xlsx)" : "Objects (.xlsx)", run: () => exportObjects(run) },
    ...(reportRun
      ? [{
          format: "pdf" as const,
          label: current ? "Newest run's analysis report (PDF)" : "Analysis report (PDF)",
          run: () => downloadAuthenticated(getAnalysisReportUrl(reportRun), `meridian-analysis-${reportRun}.pdf`),
        }]
      : []),
  ];

  const rawReadiness = search.get("readiness") ?? LEGACY_VERDICT[search.get("verdict") ?? ""] ?? null;
  const readiness: ReadinessFilter | null = READINESS_FILTER.find((f) => f.value === rawReadiness)?.value ?? null;
  const dimension = search.get("dimension");
  const owner = search.get("owner");
  const shownObjs = objects
    .filter((o) => !readiness || o.readiness === readiness)
    .filter((o) => !dimension || o.worst_dimension === dimension)
    .filter((o) => !owner || o.owner === owner)
    .sort(worstFirst);
  const distinct = (pick: (o: ObjectRow) => string | null | undefined) =>
    [...new Set(objects.map(pick).filter((v): v is string => !!v))].sort().map((v) => ({ value: v, label: v }));
  const dimensionOptions = distinct((o) => o.worst_dimension);
  const ownerOptions = distinct((o) => o.owner);
  const setParam = (key: string, next: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (key === "readiness") params.delete("verdict");
    if (next) params.set(key, next); else params.delete(key);
    router.replace(`/objects?${params.toString()}`);
  };
  const listHref = (params: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(current ? {} : { run }), ...params }).toString();
    return q ? `/objects?${q}` : "/objects";
  };
  const bands = current ? currentQ.bands : data?.thresholds;
  const columns = makeColumns(current ? undefined : runId, bands, objects); // React Compiler memoizes on run and thresholds

  const notReady = objects.filter((o) => o.readiness === "fail").length; // matches the ?readiness=fail drill
  // Per run, the API's count; across the current state, each object's failing critical and high checks at its run
  // (the same definition, summed over the objects instead of one run).
  const blockingFindings = current
    ? objects.length > 0 && objects.every((o) => o.critical_checks != null && o.high_checks != null)
      ? objects.reduce((n, o) => n + (o.critical_checks ?? 0) + (o.high_checks ?? 0), 0)
      : undefined
    : data?.blocking_findings_total;
  const failingChecks = objects.reduce((a, o) => a + o.failing_checks, 0);
  const worst = objects.reduce<ObjectRow | null>((w, o) => (o.affected_records != null && (w === null || o.affected_records > (w.affected_records ?? -1)) ? o : w), null);
  const atRisk = objects.filter((o) => o.readiness === "warn").length;
  const go = objects.filter((o) => o.readiness === "pass").length;
  const summary = objects.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="m-stat-grid m-motion-stagger">
        <Stat label="Objects" value={objects.length} hint={current ? "each at its latest run" : "in this run"} href={listHref()} />
        <Stat label="Go" value={go} tone={go > 0 ? "go" : undefined} href={listHref({ readiness: "pass" })} />
        <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? "at-risk" : "go"} href={listHref({ readiness: "warn" })} />
        <Stat label="Not ready" value={notReady} tone={notReady > 0 ? "no-go" : "go"} href={listHref({ readiness: "fail" })} />
        <Stat label="Failing checks" value={failingChecks.toLocaleString()} hint="across all objects" />
        {blockingFindings != null ? <Stat label="Blocking findings" value={blockingFindings.toLocaleString()} tone={blockingFindings > 0 ? "no-go" : "go"} /> : <Stat label="Most affected" value={worst?.affected_records != null ? worst.affected_records.toLocaleString() : "—"} hint={worst ? `records in ${worst.label}` : undefined} />}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <FilterChips label="Readiness" value={readiness} options={[...READINESS_FILTER]} onChange={(v) => setParam("readiness", v)} />
        {dimensionOptions.length > 1 ? <FilterChips label="Dimension" value={dimension} options={dimensionOptions} onChange={(v) => setParam("dimension", v)} /> : null}
        {ownerOptions.length > 1 ? <FilterChips label="Owner" value={owner} options={ownerOptions} onChange={(v) => setParam("owner", v)} /> : null}
      </div>
    </div>
  );

  // Current state: the object page without ?run= opens the object's own latest run.
  const objectHref = (row: ObjectRow) => `/objects/${row.module}?${current ? "" : `run=${runId ?? run}&`}tab=rules`;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Objects"
          meta={current
            ? (newest && objects.length > 0 ? <span data-testid="run-scope">{stateScopeLine(objects.length, newest.run_at)}</span> : undefined)
            : <RunScope scope={runScope} hrefFor={(id) => hrefWithRun("/objects", search, id)} />}
          actions={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
        />
      }
      summary={summary || undefined}
      table={
        <DataTable
          columns={columns}
          data={shownObjs}
          getRowId={(row) => row.module}
          rowHref={objectHref}
          onRowClick={(row) => {
            // Seed the object's summary under the run its numbers come from, so the detail opens without a refetch.
            const target = current ? row.run_id : runId ?? run;
            if (target && row.affected_records != null) queryClient.setQueryData(queryKeys.objectSummary(row.module, target), row);
            router.push(objectHref(row));
          }}
        />
      }
      state={state}
      emptyProps={emptyProps}
      errorProps={{
        message: apiErrorMessage(query.error),
        onRetry: refetch,
      }}
    />
  );
}
