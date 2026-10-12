// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, ExplorerPage, ExportMenu, Pill, ScoreRing, Stat, emptyExportOptions, type PillTone, type ScoreBands } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObject, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { getVersion } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { FilterChips, ObjectsHeader } from "./_header";

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
/** `?verdict=` is the legacy form of `?readiness=`. */
const LEGACY_VERDICT: Record<string, ReadinessFilter | "not_ready"> = { ready: "pass", not_ready: "not_ready" };

const makeColumns = (run: string, bands: ScoreBands | undefined, prefetch: (module: string) => void): ColumnDef<ObjectSummary>[] => [
  {
    accessorKey: "label",
    header: "Object",
    cell: ({ row }) => <span onPointerEnter={() => prefetch(row.original.module)}>{row.original.label}</span>,
  },
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
    accessorKey: "readiness",
    header: "Readiness",
    cell: ({ row }) => {
      const readiness = row.original.readiness;
      if (!readiness) return "—";
      return <Pill tone={READINESS_TONE[readiness]}>{READINESS_LABEL[readiness]}</Pill>;
    },
  },
  { accessorKey: "failing_checks", header: "Failing checks", cell: ({ row }) => drill(row.original, run, row.original.failing_checks) },
  { accessorKey: "affected_records", header: "Affected records", cell: ({ row }) => drill(row.original, run, row.original.affected_records.toLocaleString()) },
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

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode; ghost?: "table"; summary?: string } = { title: "No objects in this run", ghost: "table" };
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure({ isError, error })) {
    state = "error";
  } else if (data && objects.length === 0) {
    state = "empty";
    emptyProps = {
      title: data.run_id ? "No objects in this run" : "No objects measured yet",
      detail: data.run_id ? "Run an analysis on a connected system." : dayOne.step?.detail ?? "Run an extraction to analyse your first objects.",
      summary: data.run_id ? undefined : "Objects appear after the first analysis.",
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
  const readiness: ReadinessFilter | "not_ready" | null =
    READINESS_FILTER.find((f) => f.value === rawReadiness)?.value ?? (rawReadiness === "not_ready" ? "not_ready" : null);
  const matches = (o: ObjectSummary) => readiness === "not_ready" ? o.readiness !== "pass" : o.readiness === readiness;
  const shownObjs = (readiness ? objects.filter(matches) : objects).slice().sort(worstFirst);
  const setReadiness = (next: ReadinessFilter | null) => {
    const params = new URLSearchParams(search.toString());
    params.delete("verdict");
    if (next) params.set("readiness", next); else params.delete("readiness");
    router.replace(`/objects?${params.toString()}`);
  };
  const prefetch = (module: string) => {
    if (!runId) return;
    void queryClient.prefetchQuery({ queryKey: queryKeys.object(module, runId), queryFn: () => getObject(module, runId) });
  };
  const columns = makeColumns(runId ?? run, data?.thresholds, prefetch); // React Compiler memoizes on run and thresholds

  const notReady = objects.filter((o) => o.readiness !== "pass").length;
  const failingChecks = objects.reduce((a, o) => a + o.failing_checks, 0);
  const summary = objects.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        <Stat label="Not ready" value={notReady} hint={`of ${objects.length} objects`} tone={notReady > 0 ? "no-go" : "go"} href={`/objects?run=${run}&readiness=not_ready`} />
        <Stat label="Failing checks" value={failingChecks.toLocaleString()} hint="across all objects" />
      </div>
      <FilterChips
        label="Readiness"
        value={readiness === "not_ready" ? null : readiness}
        options={[...READINESS_FILTER]}
        onChange={setReadiness}
      />
    </div>
  );

  return (
    <ExplorerPage
      filterBar={
        <ObjectsHeader
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
          onRowClick={(row) => router.push(`/objects/${row.module}?run=${runId ?? run}&tab=rules`)}
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
