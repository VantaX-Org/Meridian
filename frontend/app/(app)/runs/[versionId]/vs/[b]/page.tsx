// frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, Pager, ReportPage, Skeleton, Sparkline, Waterfall, type ChartPoint } from "@/design";
import { compareRecordKeys, compareRecords, type RecordDiffCheck } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";

const KEYS_PAGE_SIZE = 25;

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

export default function CompareRunsPage() {
  const { versionId: a, b } = useParams<{ versionId: string; b: string }>();
  const [checkId, setCheckId] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState("");
  const [keyPage, setKeyPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.runCompare(a, b),
    queryFn: () => compareRecords(b, a),
  });

  const keys = useQuery({
    queryKey: [...queryKeys.runCompare(a, b), "keys", checkId, "new"],
    queryFn: () => compareRecordKeys(checkId ?? "", { v1: a, v2: b, change: "new" }),
    enabled: !!checkId,
  });

  const filteredKeys = useMemo(() => {
    const all = keys.data?.record_keys ?? [];
    const needle = keyFilter.trim().toLowerCase();
    return needle ? all.filter((key) => key.toLowerCase().includes(needle)) : all;
  }, [keys.data, keyFilter]);
  const keyPageCount = Math.max(1, Math.ceil(filteredKeys.length / KEYS_PAGE_SIZE));
  const pageKeys = filteredKeys.slice((keyPage - 1) * KEYS_PAGE_SIZE, keyPage * KEYS_PAGE_SIZE);

  const selectCheck = (row: RecordDiffCheck) => {
    setCheckId(row.check_id);
    setKeyFilter("");
    setKeyPage(1);
  };

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
          <DataTable columns={columns} data={data?.checks ?? []} getRowId={(row) => row.check_id} onRowClick={selectCheck} />
          {checkId && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
                New record keys for {checkId}
              </p>
              {keys.isLoading && <Skeleton height={80} />}
              {keys.isError && (
                <ErrorState
                  message={`Couldn't load the new record keys for this check. ${keys.error.message}`}
                  onRetry={() => keys.refetch()}
                />
              )}
              {keys.data && keys.data.record_keys.length === 0 && <EmptyState title="No new record keys for this check." />}
              {keys.data && keys.data.record_keys.length > 0 && (
                <>
                  <input
                    type="search"
                    aria-label="Filter record keys"
                    placeholder="Filter record keys"
                    value={keyFilter}
                    onChange={(e) => {
                      setKeyFilter(e.target.value);
                      setKeyPage(1);
                    }}
                    className="h-8 rounded border px-2 text-[13px]"
                    style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  />
                  <ul className="flex flex-col gap-1">
                    {pageKeys.map((key) => (
                      <li key={key}>
                        <Mono>{key}</Mono>
                      </li>
                    ))}
                  </ul>
                  <Pager page={keyPage} pageCount={keyPageCount} onPageChange={setKeyPage} />
                </>
              )}
            </div>
          )}
        </div>
      }
      state={state}
      emptyProps={{ title: "No differences. These two runs have identical results." }}
      errorProps={{ message: `Couldn't compare these runs. ${error?.message ?? ""}`.trim(), onRetry: () => refetch() }}
    />
  );
}
