// frontend/app/(app)/objects/page.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Pill, ScoreRing, SeverityDot, type PillTone } from "@/design";
import { getObjects, type ObjectSummary } from "@/lib/api/v1/objects";

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

const columns: ColumnDef<ObjectSummary>[] = [
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
          <span>{score}</span>
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
        {row.original.failing_checks}
      </span>
    ),
  },
  { accessorKey: "affected_records", header: "Affected records" },
];

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["objects", run],
    queryFn: () => getObjects(run),
    enabled: !!run,
  });

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps = { title: "Select a run to see its objects." };
  if (!run) {
    state = "empty";
  } else if (isLoading) {
    state = "loading";
  } else if (isError) {
    state = "error";
  } else if (data && data.objects.length === 0) {
    state = "empty";
    emptyProps = { title: "No objects for this run. This run has no analysed objects yet." };
  }

  return (
    <ExplorerPage
      table={
        <DataTable
          columns={columns}
          data={data?.objects ?? []}
          getRowId={(row) => row.module}
          onRowClick={(row) => router.push(`/objects/${row.module}?run=${run}`)}
        />
      }
      state={state}
      emptyProps={emptyProps}
      errorProps={{
        message: "Couldn't load objects. Try again, or pick a different run.",
        onRetry: () => router.push(`/objects?run=${run}`),
      }}
    />
  );
}
