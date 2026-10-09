// frontend/app/(app)/objects/[object]/page.tsx
"use client";

import type { ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Bar, Button, DataTable, ReportPage, SeverityDot, isSeverity } from "@/design";
import { getObject, type ObjectRule } from "@/lib/api/v1/objects";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const columns: ColumnDef<ObjectRule>[] = [
  {
    accessorKey: "severity",
    header: "Severity",
    cell: ({ row }) =>
      isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} /> : row.original.severity,
  },
  { accessorKey: "check_id", header: "Check" },
  { accessorKey: "dimension", header: "Dimension" },
  { accessorKey: "affected_count", header: "Affected" },
  {
    accessorKey: "pass_rate",
    header: "Pass rate",
    cell: ({ row }) => (row.original.pass_rate == null ? "—" : `${Math.round(row.original.pass_rate * 100)}%`),
  },
];

export default function ObjectDetailPage() {
  const params = useParams<{ object: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const object = params.object;
  const run = search.get("run") ?? "";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.object(object, run),
    queryFn: () => getObject(object, run),
    enabled: !!run,
  });

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode } = {
    title: "Select a run to see this object's data quality.",
  };
  if (!run) {
    state = "empty";
  } else if (isLoading) {
    state = "loading";
  } else if (isError) {
    state = "error";
  } else if (data && data.rules.length === 0) {
    state = "empty";
    emptyProps = {
      title: "No results for this object in this run.",
      detail: "The run did not include this object's module.",
      action: <Button render={<Link href={`/objects?run=${run}`}>All objects</Link>} />,
    };
  }

  const failing = data?.failing_checks ?? 0;
  const total = data?.rules.length ?? 0;
  const narrative = data
    ? `${failing} of ${total} checks fail. Composite score ${data.composite_score ?? "—"}.`
    : "Loading object data quality...";

  const rulesRanked = data ? [...data.rules].sort((a, b) => b.affected_count - a.affected_count) : [];

  const dimensionPoints = data
    ? Object.entries(data.dimension_scores).map(([dimension, score]) => ({ x: dimension, y: score }))
    : [];

  return (
    <ReportPage
      narrative={narrative}
      charts={<Bar data={dimensionPoints} />}
      tables={
        <DataTable
          columns={columns}
          data={rulesRanked}
          getRowId={(row) => row.check_id}
          onRowClick={(row) => router.push(`/objects/${object}/rules/${row.check_id}?run=${run}`)}
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
