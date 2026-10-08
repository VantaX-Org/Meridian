// frontend/app/(app)/runs/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage } from "@/design";
import { getVersions } from "@/lib/api/versions";
import { getSystems } from "@/lib/api/systems";
import type { Version } from "@/types/api";
import { formatDate, formatModuleName } from "@/lib/format";

function makeColumns(systemName: Map<string, string>): ColumnDef<Version>[] {
  return [
    { accessorKey: "label", header: "Run", cell: ({ row }) => row.original.label ?? row.original.id },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "run_at", header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    {
      id: "system",
      header: "System",
      cell: ({ row }) => {
        const systemId = row.original.metadata?.system_id;
        return systemId ? systemName.get(systemId) ?? systemId : "—";
      },
    },
    {
      id: "modules",
      header: "Modules",
      cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", "),
    },
  ];
}

export default function RunsPage() {
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", "list"],
    queryFn: () => getVersions(),
  });
  const systemsQuery = useQuery({ queryKey: ["systems", "list"], queryFn: getSystems });
  const systemName = useMemo(
    () => new Map((systemsQuery.data ?? []).map((s) => [s.id, s.name])),
    [systemsQuery.data],
  );
  const columns = useMemo(() => makeColumns(systemName), [systemName]);

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
