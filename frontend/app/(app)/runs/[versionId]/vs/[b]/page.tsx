// frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, ReportPage, Skeleton, Sparkline, Waterfall, type ChartPoint } from "@/design";
import { compareRecordKeys, compareRecords, type RecordDiffCheck } from "@/lib/api/versions";

export default function CompareRunsPage() {
  const { versionId: a, b } = useParams<{ versionId: string; b: string }>();
  const [selectedCheck, setSelectedCheck] = useState<RecordDiffCheck | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", a, "vs", b],
    queryFn: () => compareRecords(b, a),
  });

  const keys = useQuery({
    queryKey: ["run", a, "vs", b, "keys", selectedCheck?.check_id, "new"],
    queryFn: () => compareRecordKeys(selectedCheck!.check_id, { v1: a, v2: b, change: "new" }),
    enabled: !!selectedCheck,
  });

  const columns: ColumnDef<RecordDiffCheck>[] = [
    { accessorKey: "check_id", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { accessorKey: "severity", header: "Severity" },
    { accessorKey: "new", header: "New" },
    { accessorKey: "resolved", header: "Resolved" },
    { accessorKey: "persisting", header: "Persisting" },
    {
      id: "trend",
      header: "Trend",
      cell: ({ row }) => {
        const points: ChartPoint[] = [
          { x: "before", y: row.original.persisting + row.original.resolved },
          { x: "after", y: row.original.persisting + row.original.new },
        ];
        return <Sparkline data={points} />;
      },
    },
  ];

  const waterfallData: ChartPoint[] = data
    ? [
        { x: "Resolved", y: -data.totals.resolved },
        { x: "New", y: data.totals.new },
        { x: "Persisting", y: data.totals.persisting },
      ]
    : [];

  const state: "loading" | "empty" | "error" | undefined = isLoading
    ? "loading"
    : isError
      ? "error"
      : data && data.checks.length === 0
        ? "empty"
        : undefined;

  return (
    <ReportPage
      narrative={data ? `${data.totals.new} new, ${data.totals.resolved} resolved, ${data.totals.persisting} persisting.` : "Comparing runs..."}
      charts={<Waterfall data={waterfallData} />}
      tables={
        <div className="flex flex-col gap-4">
          <DataTable
            columns={columns}
            data={data?.checks ?? []}
            getRowId={(row) => row.check_id}
            onRowClick={(row) => setSelectedCheck(row)}
          />
          {selectedCheck && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
                New record keys for {selectedCheck.check_id}
              </p>
              {keys.isLoading && <Skeleton height={80} />}
              {keys.isError && <ErrorState message="Couldn't load the field correlation for this check." />}
              {keys.data && keys.data.record_keys.length === 0 && <EmptyState title="No new record keys for this check." />}
              {keys.data && keys.data.record_keys.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {keys.data.record_keys.map((key) => (
                    <li key={key}>
                      <Mono>{key}</Mono>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      }
      state={state}
      emptyProps={{ title: "No differences. These two runs have identical results." }}
      errorProps={{ message: "Couldn't compare these runs. Try again." }}
    />
  );
}
