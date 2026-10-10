// frontend/app/(app)/insights/impact/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, ReportPage } from "@/design";
import { getImpact, type ImpactRow } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const columns: ColumnDef<ImpactRow>[] = [
  {
    accessorKey: "feature",
    header: "Feature",
    cell: ({ row }) => (
      <DrillLink object={row.original.feature} filters={{ causing_rules: row.original.causing_rules.join(",") }}>
        {row.original.feature}
      </DrillLink>
    ),
  },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "record_count", header: "Blocked records" },
  {
    accessorKey: "value_at_risk",
    header: "Value at risk",
    cell: ({ row }) => row.original.value_at_risk.toLocaleString(),
  },
];

export default function ImpactPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("impact", run),
    queryFn: () => getImpact({ version_id: run }),
  });

  const rows = data?.rows ?? [];

  return (
    <ReportPage
      narrative="value_at_risk = record_count × value_per_record"
      charts={null}
      tables={<DataTable columns={columns} data={rows} getRowId={(row) => row.feature} />}
      state={isLoading || dayOne.status === "loading" ? "loading" : isListFailure({ isError, error }) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No impact results yet.",
        detail: dayOne.step?.detail ?? "Impact builds up once a run has blocked or degraded features.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
      }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
