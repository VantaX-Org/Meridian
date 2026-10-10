"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Pill, type PillTone } from "@/design";
import { apiErrorMessage } from "@/lib/api/optional";
import { getS4Readiness, type S4Area } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const TONE: Record<string, PillTone> = { green: "go", amber: "at-risk", red: "no-go" };

const COLUMNS: ColumnDef<S4Area>[] = [
  { accessorKey: "label", header: "Area" },
  { id: "status", header: "Status", cell: ({ row }) => <Pill tone={TONE[row.original.status] ?? "neutral"}>{formatModuleName(row.original.status)}</Pill> },
  { id: "rules", header: "Rules", cell: ({ row }) => row.original.rules },
  { id: "failing", header: "Failing rules", cell: ({ row }) => row.original.failing },
  { id: "blocking", header: "Blocking", cell: ({ row }) => row.original.blocking_failing },
  { id: "records", header: "Failing records", cell: ({ row }) => row.original.failing_records.toLocaleString() },
];

export function S4Tab({ versionId }: { versionId: string | null }) {
  const s4 = useQuery({
    queryKey: queryKeys.s4Readiness(versionId ?? ""),
    queryFn: () => getS4Readiness(versionId ?? ""),
    enabled: versionId !== null,
  });
  if (!versionId) return <EmptyState title="Run this wave to see S/4 simplification areas." />;
  if (s4.isError) return <ErrorState message={apiErrorMessage(s4.error)} onRetry={() => void s4.refetch()} />;
  return <DataTable columns={COLUMNS} data={s4.data?.areas ?? []} getRowId={(a) => a.area} />;
}
