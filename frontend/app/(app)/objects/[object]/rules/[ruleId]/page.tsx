// frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, ExportMenu, Mono, Pager, Skeleton } from "@/design";
import { exportFindingRecords } from "@/lib/api/findings";
import { getFindingRecords, type FindingRecord } from "@/lib/api/versions";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const PAGE_SIZE = 25;

export default function RuleDetailPage() {
  const params = useParams<{ object: string; ruleId: string }>();
  const search = useSearchParams();
  const object = params.object;
  const ruleId = params.ruleId;
  const run = search.get("run") ?? "";
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...queryKeys.rule(ruleId, run), page],
    queryFn: () => getFindingRecords(run, ruleId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    enabled: !!run,
  });

  const columns = useMemo<ColumnDef<FindingRecord>[]>(
    () => [
      { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
      { accessorKey: "grain", header: "Grain", cell: ({ row }) => row.original.grain ?? "—" },
      { accessorKey: "module", header: "Module" },
      {
        id: "fix",
        header: "Fix sheet",
        cell: ({ row }) => (
          // DrillLink can only target /objects/[object] and /objects/[object]/rules/[ruleId];
          // it has no way to address the record fix-sheet route, so this is a plain Link.
          <Link
            href={`/objects/${object}/records/${encodeURIComponent(row.original.record_key)}?run=${run}`}
            style={{ color: "var(--m-accent)" }}
          >
            Open fix sheet
          </Link>
        ),
      },
    ],
    [object, run],
  );

  if (!run) {
    return <EmptyState title="Select a run to see this rule's failing records." />;
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Skeleton height={32} />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        message={apiErrorMessage(error)}
        onRetry={() => refetch()}
      />
    );
  }
  if (!data || data.records.length === 0) {
    return (
      <EmptyState
        title="No failing records for this rule."
        detail="Every record passed this check in this run."
        action={<Button render={<Link href={`/objects/${object}?run=${run}`}>Back to object</Link>} />}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const exportOptions = [{ format: "xlsx" as const, run: () => exportFindingRecords(run, ruleId, "xlsx") }];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
          {data.total} record{data.total === 1 ? "" : "s"} fail {ruleId}.
        </p>
        <ExportMenu options={exportOptions} />
      </div>
      <DataTable columns={columns} data={data.records} getRowId={(row) => row.record_key} />
      <Pager page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
