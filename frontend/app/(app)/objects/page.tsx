// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, ExplorerPage, ExportMenu, Pill, ScoreRing, SeverityDot, Stat, emptyExportOptions, type PillTone } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
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

const makeColumns = (run: string): ColumnDef<ObjectSummary>[] => [
  { accessorKey: "label", header: "Object" },
  {
    accessorKey: "composite_score",
    header: "DQS",
    cell: ({ row }) => {
      const score = row.original.composite_score;
      if (score == null) return "—";
      return (
        <span className="inline-flex items-center gap-2">
          <ScoreRing score={score} size={24} />
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
  } else if (data && data.objects.length === 0) {
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

  const exportOptions = [{ format: "xlsx" as const, run: () => exportObjects(run) }];

  const objs = data?.objects ?? [];
  const ready = objs.filter((o) => o.readiness === "pass").length;
  const firstReady = objs.find((o) => o.readiness === "pass");
  const firstNotReady = objs.find((o) => o.readiness !== "pass");
  const columns = makeColumns(run); // React Compiler memoizes on run
  const hero = objs.length > 0 && (
    <div className="flex flex-wrap gap-6">
      <Stat label="Objects" value={objs.length} href={`/objects/${objs[0].module}?run=${run}`} />
      <Stat label="Ready" value={ready} tone="go" href={firstReady ? `/objects/${firstReady.module}?run=${run}` : undefined} />
      <Stat label="Not ready" value={objs.length - ready} tone={objs.length - ready > 0 ? "no-go" : "go"} hint={`${objs.reduce((a, o) => a + o.failing_checks, 0)} failing checks`} href={firstNotReady ? `/objects/${firstNotReady.module}?run=${run}&tab=rules` : undefined} />
    </div>
  );

  return (
    <ExplorerPage
      summary={hero || undefined}
      toolbarEnd={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
      table={
        <DataTable
          columns={columns}
          data={data?.objects ?? []}
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
