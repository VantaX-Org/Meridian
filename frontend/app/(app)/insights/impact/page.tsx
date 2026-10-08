// frontend/app/(app)/insights/impact/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, ReportPage } from "@/design";
import { getImpact, type ImpactRow } from "@/lib/api/insights";
import { queryKeys } from "@/lib/query-keys";

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
      state={isLoading ? "loading" : isError ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No blocked or degraded features for this run yet." }}
      errorProps={{
        message: error instanceof Error ? error.message : "Couldn't load feature impact. Try again.",
        onRetry: () => refetch(),
      }}
    />
  );
}
