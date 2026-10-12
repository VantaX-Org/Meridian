// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, DrillLink, ExplorerPage, ExportMenu, Pill, ScoreRing, SeverityDot, Stat, emptyExportOptions, type PillTone, type ScoreBands } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

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

const makeColumns = (run: string, bands?: ScoreBands): ColumnDef<ObjectSummary>[] => [
  { accessorKey: "label", header: "Object" },
  {
    accessorKey: "composite_score",
    header: "DQS",
    cell: ({ row }) => {
      const score = row.original.composite_score;
      if (score == null) return "—";
      return (
        <span className="inline-flex items-center gap-2">
          <ScoreRing score={score} size={24} bands={bands} />
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
  {
    accessorKey: "failing_checks",
    header: "Failing checks",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1">
        <SeverityDot severity={row.original.failing_checks > 0 ? "high" : "pass"} />
        {drill(row.original, run, row.original.failing_checks)}
      </span>
    ),
  },
  { accessorKey: "affected_records", header: "Affected records", cell: ({ row }) => drill(row.original, run, row.original.affected_records) },
];

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "latest";
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
  });

  // Ruling 7: objects outside a module-scoped user's grants are hidden (UI filter; the API enforces scope).
  const { scopeFilter } = usePermissions();
  const objects = (data?.objects ?? []).filter((o) => !scopeFilter.modules || scopeFilter.modules.has(o.module));

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode; ghost?: "table"; summary?: string } = {
    title: "No objects measured yet.",
    summary: "Objects appear after the first analysis.",
    ghost: "table",
  };
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure({ isError, error })) {
    state = "error";
  } else if (data && objects.length === 0) {
    state = "empty";
    emptyProps = data.run_id
      ? { title: "No objects for this run. This run has no analysed objects yet.", ghost: "table" }
      : {
          title: "No objects measured yet.",
          summary: "Objects appear after the first analysis.",
          detail: dayOne.step?.detail ?? "Run an extraction to analyse your first objects.",
          action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
          ghost: "table",
        };
  }

  const reportRun = data?.run_id; // no run yet: there is no report to download
  const exportOptions = [
    { format: "xlsx" as const, run: () => exportObjects(run) },
    ...(reportRun
      ? [{
          format: "pdf" as const,
          label: "Analysis report (PDF)",
          run: () => downloadAuthenticated(getAnalysisReportUrl(reportRun), `meridian-analysis-${reportRun}.pdf`),
        }]
      : []),
  ];

  const objs = objects;
  const ready = objs.filter((o) => o.readiness === "pass").length;
  const rawVerdict = search.get("verdict") ?? (search.get("readiness") === "fail" ? "not_ready" : null);
  const verdict = rawVerdict === "ready" || rawVerdict === "not_ready" ? rawVerdict : null;
  const shownObjs = verdict ? objs.filter((o) => (o.readiness === "pass") === (verdict === "ready")) : objs;
  const columns = makeColumns(run, data?.thresholds); // React Compiler memoizes on run and thresholds
  const hero = objs.length > 0 && (
    <div className="flex flex-wrap gap-6">
      <Stat label="Objects" value={objs.length} />
      <Stat label="Ready" value={ready} tone="go" href={`/objects?run=${run}&verdict=ready`} />
      <Stat label="Not ready" value={objs.length - ready} tone={objs.length - ready > 0 ? "no-go" : "go"} hint={`${objs.reduce((a, o) => a + o.failing_checks, 0)} failing checks`} href={`/objects?run=${run}&verdict=not_ready`} />
    </div>
  );

  return (
    <ExplorerPage
      filterBar={verdict ? (
        <div className="flex items-center gap-2 text-[13px]">
          <span style={{ color: "var(--m-ink-2)" }}>Showing {verdict === "ready" ? "ready" : "not ready"} objects.</span>
          <Button variant="secondary" onClick={() => router.replace(`/objects?run=${run}`)}>Show all objects</Button>
        </div>
      ) : undefined}
      summary={hero || undefined}
      toolbarEnd={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
      table={
        <DataTable
          columns={columns}
          data={shownObjs}
          getRowId={(row) => row.module}
          onRowClick={(row) => router.push(`/objects/${row.module}?run=${run}&tab=rules`)}
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
