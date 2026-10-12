// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DomainChip, useBreadcrumbScope, DrillLink, ExplorerPage, ExportMenu, Mono, PageHeader, Pill, ScoreRing, Sparkline, Stat, emptyExportOptions, type CellMeta, type PillTone, type ScoreBands } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { getVersion } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { barFill } from "@/design/table/columns";
import { DIMENSIONS } from "@/lib/home-metrics";
import { formatModuleName } from "@/lib/format";
import { bySeverity } from "../_severity-sort";
import { FilterChips } from "./_header";

const READINESS_LABEL: Record<"pass" | "warn" | "fail", string> = {
  pass: "Go",
  warn: "At risk",
  fail: "No-go",
};
const READINESS_TONE: Record<"pass" | "warn" | "fail", PillTone> = {
  pass: "go",
  warn: "at-risk",
  fail: "no-go",
};

/** Number cells drill to the object's rules tab. */
const drill = (o: ObjectSummary, run: string, n: number | string) => (
  <DrillLink object={o.module} run={run === "latest" ? undefined : run} filters={{ tab: "rules" }}>{n}</DrillLink>
);

const RANK: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
/** Worst readiness first, then DQS ascending; unscored objects last. */
const worstFirst = (a: ObjectSummary, b: ObjectSummary) =>
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
const makeColumns = (run: string, bands: ScoreBands | undefined, objects: ObjectSummary[]): ColumnDef<ObjectSummary>[] => {
  const hasTrend = objects.some((o) => (o.trend?.length ?? 0) >= 2);
  const hasBlocking = objects.some((o) => o.blocking_rule_id);
  const hasDims = objects.some((o) => o.dimension_scores && Object.keys(o.dimension_scores).length > 0);
  return allColumns(run, bands).filter((c) => (c.id !== "trend" || hasTrend) && (c.id !== "blocking_rule" || hasBlocking) && (c.id !== "dimensions" || hasDims));
};

const allColumns = (run: string, bands: ScoreBands | undefined): ColumnDef<ObjectSummary>[] => [
  { accessorKey: "label", header: "Object", cell: ({ row }) => <DomainChip moduleId={row.original.module} label={row.original.label} /> },
  {
    accessorKey: "composite_score",
    header: "DQS",
    cell: ({ row }) => {
      const score = row.original.composite_score;
      if (score == null) return "—";
      return (
        <span className="inline-flex items-center gap-2">
          <ScoreRing score={score} size={16} bands={bands} />
          {drill(row.original, run, score)}
        </span>
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
      return <Pill tone={READINESS_TONE[readiness]} variant="solid">{READINESS_LABEL[readiness]}</Pill>;
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
            return <span key={d} className="m-bar-fill" {...(v === undefined ? {} : barFill(v, { max: 100, tone: "rate" })?.attr)} style={{ width: 10, height: 14, borderRadius: 2, background: v === undefined ? "var(--m-line)" : undefined }} />;
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
        <DrillLink href={`/objects/${row.original.module}?run=${run}&tab=records&check_id=${encodeURIComponent(id)}`}>
          <Mono>{id}</Mono>
        </DrillLink>
      );
    },
  },
  { accessorKey: "failing_checks", header: "Failing checks", size: 120, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => drill(row.original, run, row.original.failing_checks) },
  { accessorKey: "affected_records", header: "Affected records", size: 130, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => drill(row.original, run, row.original.affected_records.toLocaleString()) },
];

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const run = search.get("run") ?? "latest";
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
  });
  // Detail links carry the resolved run id so list and detail share one cache key.
  const runId = data?.run_id ?? (run === "latest" ? undefined : run);

  const { data: version } = useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => getVersion(runId ?? ""),
    enabled: !!runId,
  });

  // Ruling 7: objects outside a module-scoped user's grants are hidden (UI filter; the API enforces scope).
  const { scopeFilter } = usePermissions();
  const objects = (data?.objects ?? []).filter((o) => !scopeFilter.modules || scopeFilter.modules.has(o.module));

  useBreadcrumbScope(data ? [`${objects.length} objects`, ...(version?.label ? [`run ${version.label}`] : [])] : []);

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode; ghost?: "table" } = { title: "No objects in this run", ghost: "table" };
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure({ isError, error })) {
    state = "error";
  } else if (data && objects.length === 0) {
    state = "empty";
    emptyProps = {
      title: data.run_id ? "No objects in this run" : "No objects measured yet",
      detail: data.run_id ? "Run an analysis on a connected system." : dayOne.step?.detail ?? "Run an extraction to analyse your first objects.",
      action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      ghost: "table",
    };
  }

  const reportRun = data?.run_id; // no run yet: there is no report to download
  const exportOptions = [
    { format: "xlsx" as const, label: "Objects (.xlsx)", run: () => exportObjects(run) },
    ...(reportRun
      ? [{
          format: "pdf" as const,
          label: "Analysis report (PDF)",
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
  const distinct = (pick: (o: ObjectSummary) => string | null | undefined) =>
    [...new Set(objects.map(pick).filter((v): v is string => !!v))].sort().map((v) => ({ value: v, label: v }));
  const dimensionOptions = distinct((o) => o.worst_dimension);
  const ownerOptions = distinct((o) => o.owner);
  const setParam = (key: string, next: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (key === "readiness") params.delete("verdict");
    if (next) params.set(key, next); else params.delete(key);
    router.replace(`/objects?${params.toString()}`);
  };
  const columns = makeColumns(runId ?? run, data?.thresholds, objects); // React Compiler memoizes on run and thresholds

  const notReady = objects.filter((o) => o.readiness === "fail").length; // matches the ?readiness=fail drill
  const blockingFindings = data?.blocking_findings_total;
  const failingChecks = objects.reduce((a, o) => a + o.failing_checks, 0);
  const affected = objects.reduce((a, o) => a + o.affected_records, 0);
  const atRisk = objects.filter((o) => o.readiness === "warn").length;
  const go = objects.filter((o) => o.readiness === "pass").length;
  const summary = objects.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="m-stat-grid m-motion-stagger">
        <Stat label="Objects" value={objects.length} hint="in this run" href={`/objects?run=${run}`} />
        <Stat label="Go" value={go} tone={go > 0 ? "go" : undefined} href={`/objects?run=${run}&readiness=pass`} />
        <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? "at-risk" : "go"} href={`/objects?run=${run}&readiness=warn`} />
        <Stat label="Not ready" value={notReady} tone={notReady > 0 ? "no-go" : "go"} href={`/objects?run=${run}&readiness=fail`} />
        <Stat label="Failing checks" value={failingChecks.toLocaleString()} hint="across all objects" />
        {blockingFindings != null ? <Stat label="Blocking findings" value={blockingFindings.toLocaleString()} tone={blockingFindings > 0 ? "no-go" : "go"} /> : <Stat label="Affected records" value={affected.toLocaleString()} />}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <FilterChips label="Readiness" value={readiness} options={[...READINESS_FILTER]} onChange={(v) => setParam("readiness", v)} />
        {dimensionOptions.length > 1 ? <FilterChips label="Dimension" value={dimension} options={dimensionOptions} onChange={(v) => setParam("dimension", v)} /> : null}
        {ownerOptions.length > 1 ? <FilterChips label="Owner" value={owner} options={ownerOptions} onChange={(v) => setParam("owner", v)} /> : null}
      </div>
    </div>
  );

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Objects"
          meta={version?.label ? `Run ${version.label}` : undefined}
          actions={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
        />
      }
      summary={summary || undefined}
      table={
        <DataTable
          columns={columns}
          data={shownObjs}
          getRowId={(row) => row.module}
          rowHref={(row) => `/objects/${row.module}?run=${runId ?? run}&tab=rules`}
          onRowClick={(row) => {
            const target = runId ?? run;
            queryClient.setQueryData(queryKeys.objectSummary(row.module, target), row);
            router.push(`/objects/${row.module}?run=${target}&tab=rules`);
          }}
        />
      }
      state={state}
      emptyProps={emptyProps}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
