// frontend/app/(app)/runs/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage } from "@/design";
import { getVersions } from "@/lib/api/versions";
import type { Version } from "@/types/api";
import { formatDate, formatModuleName } from "@/lib/format";

const columns: ColumnDef<Version>[] = [
  { accessorKey: "label", header: "Run", cell: ({ row }) => row.original.label ?? row.original.id },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "run_at", header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
  {
    id: "modules",
    header: "Modules",
    cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", "),
  },
];

export default function RunsPage() {
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", "list"],
    queryFn: () => getVersions(),
  });

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading) {
    state = "loading";
  } else if (isError) {
    state = "error";
  } else if (data && data.versions.length === 0) {
    state = "empty";
  }

  return (
    <ExplorerPage
      table={
        <DataTable
          columns={columns}
          data={data?.versions ?? []}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/runs/${row.id}`)}
        />
      }
      state={state}
      emptyProps={{ title: "No runs yet. Upload a file or connect a system to start a run." }}
      errorProps={{ message: "Couldn't load runs. Try again.", onRetry: () => router.refresh() }}
    />
  );
}
