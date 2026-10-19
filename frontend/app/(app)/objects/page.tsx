// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DomainChip, useBreadcrumbScope, DrillLink, ExplorerPage, ExportMenu, Mono, ObjectMap, PageHeader, Sparkline, Stat, emptyExportOptions, type CellMeta, type ObjectMapItem, type ScoreBands, Status, Score } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { getVersion } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { stateScopeLine } from "@/lib/current-state";
import { formatModuleName } from "@/lib/format";
import { bySeverity } from "../_severity-sort";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun } from "@/lib/run-scope";
import { FilterChips } from "./_header";
import { useCurrentObjects } from "./_current";

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

/** Findings that block a load: failing critical and high checks (absent on older backends, which rank on records alone). */
const blockingOf = (o: ObjectRow) => (o.critical_checks ?? 0) + (o.high_checks ?? 0);
/** The ledger's order: most blocking findings, then most records affected, then lowest DQS; unscored objects last. */
const ranked = (a: ObjectRow, b: ObjectRow) =>
  blockingOf(b) - blockingOf(a) || (b.affected_records ?? 0) - (a.affected_records ?? 0) || (a.composite_score ?? 101) - (b.composite_score ?? 101);

const MAP_VERDICT = { fail: "no-go", warn: "at-risk", pass: "go" } as const;

const READINESS_FILTER = [
  { value: "fail", label: "No-go" },
  { value: "warn", label: "At risk" },
  { value: "pass", label: "Go" },
] as const;
type ReadinessFilter = (typeof READINESS_FILTER)[number]["value"];
/** `?verdict=` is the legacy form of `?readiness=` (ready means pass; not_ready has no equivalent and is ignored). */
const LEGACY_VERDICT: Record<string, ReadinessFilter> = { ready: "pass" };

/** Optional enrichment columns appear only when some row carries the field (older backends omit them). */
const makeColumns = (run: string | undefined, bands: ScoreBands | undefined, objects: ObjectRow[], openHref: (o: ObjectRow) => string): ColumnDef<ObjectRow>[] => {
  const hasTrend = objects.some((o) => (o.trend?.length ?? 0) >= 1);
  const hasBlocking = objects.some((o) => o.blocking_rule_id);
  return allColumns(run, bands, openHref).filter((c) => (c.id !== "trend" || hasTrend) && (c.id !== "blocking_rule" || hasBlocking));
};

const allColumns = (run: string | undefined, bands: ScoreBands | undefined, openHref: (o: ObjectRow) => string): ColumnDef<ObjectRow>[] => [
  { accessorKey: "label", header: "Object", cell: ({ row }) => <DomainChip moduleId={row.original.module} label={row.original.label} /> },
  {
    id: "blocking_rule",
    header: "Blocking rule",
    enableSorting: false,
    size: 280,
    cell: ({ row }) => {
      const id = row.original.blocking_rule_id;
      if (!id) return "—";
      const words = row.original.blocking_rule_name;
      return (
        // One line per row: a long check id or name is cut with an ellipsis; the id names the rule in full by its title.
        <span className="block max-w-[280px] truncate whitespace-nowrap" title={id} data-testid="blocking-rule-id">
          <DrillLink href={`/objects/${row.original.module}?${run ? `run=${run}&` : ""}tab=records&check_id=${encodeURIComponent(id)}`}>
            <Mono>{id}</Mono>
          </DrillLink>
          {words && words !== id ? <span className="m-ink-2">{" "}{words}</span> : null}
        </span>
      );
    },
  },
  {
    id: "affected_records",
    accessorFn: (o) => o.affected_records ?? -1,
    header: "Records",
    size: 110,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => (row.original.affected_records == null ? "—" : drill(row.original, run, row.original.affected_records.toLocaleString())),
  },
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
    header: "Verdict",
    sortingFn: bySeverity,
    meta: { severity: true } satisfies CellMeta,
    cell: ({ row }) => {
      const readiness = row.original.readiness;
      if (!readiness) return "—";
      return <Status kind="verdict" value={readiness} variant="solid" />;
    },
  },
  {
    id: "trend",
    header: "Trend",
    size: 96,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => {
      const t = row.original.trend ?? [];
      // The object's first scored run in its lineage has no trend yet: say so instead of a dash.
      if (t.length === 1) return <span className="m-text-meta m-ink-3" data-testid="trend-first-run">1 run</span>;
      return t.length >= 2 ? <Sparkline data={t.map((y, x) => ({ x, y }))} /> : "—";
    },
  },
  {
    id: "open",
    header: "Action",
    enableSorting: false,
    size: 72,
    cell: ({ row }) => (
      <Link
        href={openHref(row.original)}
        className="m-text-meta font-medium m-ink-accent-ink hover:underline"
        aria-label={`Open ${row.original.label}`}
        onClick={(e) => e.stopPropagation()}
      >
        Open
      </Link>
    ),
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
    .sort(ranked);
  const distinct = (pick: (o: ObjectRow) => string | null | undefined, label: (v: string) => string = (v) => v) =>
    [...new Set(objects.map(pick).filter((v): v is string => !!v))].sort().map((v) => ({ value: v, label: label(v) }));
  // Chips name the dimension ("Accuracy"); the URL keeps the raw id (`?dimension=accuracy`).
  const dimensionOptions = distinct((o) => o.worst_dimension, formatModuleName);
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
  
  const notReady = objects.filter((o) => o.readiness === "fail").length; // matches the ?readiness=fail drill
  // Per run, the API's count; across the current state, each object's failing critical and high checks at its run
  // (the same definition, summed over the objects instead of one run).
  const blockingFindings = current
    ? objects.length > 0 && objects.every((o) => o.critical_checks != null && o.high_checks != null)
      ? objects.reduce((n, o) => n + (o.critical_checks ?? 0) + (o.high_checks ?? 0), 0)
      : undefined
    : data?.blocking_findings_total;
  const failingChecks = objects.reduce((a, o) => a + o.failing_checks, 0);
  const recordsAffected = objects.reduce((n, o) => n + (o.affected_records ?? 0), 0);
  const atRisk = objects.filter((o) => o.readiness === "warn").length;
  const go = objects.filter((o) => o.readiness === "pass").length;
  // The map already draws the object count, each object's records and its verdict tint, so the stats here carry
  // what it does not: how many objects sit in each verdict, and the totals behind the ledger.
  const stats = objects.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="m-stat-grid m-motion-stagger">
        <Stat label="Go" value={go} tone={go > 0 ? "go" : undefined} href={listHref({ readiness: "pass" })} />
        <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? "at-risk" : "go"} href={listHref({ readiness: "warn" })} />
        <Stat label="Not ready" value={notReady} tone={notReady > 0 ? "no-go" : "go"} href={listHref({ readiness: "fail" })} />
        <Stat label="Failing checks" value={failingChecks.toLocaleString()} hint="across all objects" />
        {blockingFindings != null ? <Stat label="Blocking findings" value={blockingFindings.toLocaleString()} tone={blockingFindings > 0 ? "no-go" : "go"} /> : <Stat label="Records affected" value={recordsAffected.toLocaleString()} hint="across all objects" />}
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
  // "Open" lands on the workbench with the object's blocking rule selected.
  const openHref = (row: ObjectRow) =>
    `/objects/${row.module}?${current ? "" : `run=${runId ?? run}&`}${row.blocking_rule_id ? `rule=${encodeURIComponent(row.blocking_rule_id)}` : ""}`.replace(/[?&]$/, "");
  const columns = makeColumns(current ? undefined : runId, bands, objects, openHref); // React Compiler memoizes on run and thresholds

  // The map is drawn from the rows the ledger shows: the same filters, the same objects.
  const mapItems: ObjectMapItem[] = shownObjs.map((o) => ({
    id: o.module,
    label: o.label,
    href: openHref(o),
    score: o.composite_score,
    records: o.affected_records ?? 0,
    verdict: o.readiness ? MAP_VERDICT[o.readiness] : "neutral",
    meta: o.blocking_rule_id ?? (o.affected_records != null ? `${o.affected_records.toLocaleString()} records` : undefined),
  }));
  const map = shownObjs.length > 0 && <ObjectMap items={mapItems} columns={12} rowHeight={44} />;

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
      summary={map || undefined}
      strip={stats || undefined}
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
