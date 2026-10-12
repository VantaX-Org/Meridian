"use client";

/**
 * Variants tab (process-discovery spec §7.3): ranked variants, the "Other" bucket pinned last
 * (the route orders it last). The Drawer shows the sequence, its fitness and sample cases.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { getVariants, type ProcessFilterParams, type VariantRow } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { fitnessTone, fmtCount, fmtFitness, fmtSeconds, fmtShare } from "./shared";

/** api/services/process_discovery/mining.py OTHER_HASH: the bucket of every variant past the cap. */
export const OTHER_HASH = "0".repeat(32);

function Sequence({ activities }: { activities: string[] }) {
  return (
    <span className="flex max-w-[480px] gap-1 overflow-x-auto">
      {activities.map((a, i) => <Mono key={i}>{a}</Mono>)}
    </span>
  );
}

export function VariantsTable({ runId, filters, canExport, onOpenCase, onClearFilters }: {
  runId: string;
  filters: ProcessFilterParams;
  canExport: boolean;
  onOpenCase: (caseId: string) => void;
  onClearFilters?: () => void;
}) {
  const params = { ...filters, limit: 200 };
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "variants", params), queryFn: () => getVariants(runId, params) });
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={320} />;
  const rows = q.data.items;
  if (!rows.length) return <EmptyState title="No variants in this view" detail="Widen the filters to include more cases."
    action={onClearFilters && <Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>} />;

  const columns: ColumnDef<VariantRow>[] = [
    { id: "rank", header: "Rank", cell: ({ row }) => (row.original.hash === OTHER_HASH ? "—" : row.index + 1) },
    { id: "sequence", header: "Sequence", cell: ({ row }) => (row.original.hash === OTHER_HASH
        ? "All other variants" : <Sequence activities={row.original.activities} />) },
    { accessorKey: "case_count", header: "Cases", cell: ({ row }) => fmtCount(row.original.case_count) },
    { accessorKey: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.share) },
    { accessorKey: "median_seconds", header: "Median", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
    { accessorKey: "p90_seconds", header: "P90", cell: ({ row }) => fmtSeconds(row.original.p90_seconds) },
    { accessorKey: "fitness", header: "Fitness", cell: ({ row }) => (
        <Pill tone={fitnessTone(row.original.fitness)}>{fmtFitness(row.original.fitness)}</Pill>) },
  ];

  return (
    <DataTable columns={columns} data={rows} getRowId={(v) => v.hash} height="auto" dense
      tableId="process-variants" exportName={`process-variants-${runId}`}
      renderDrawer={(v) => (
        <div className="grid gap-4">
          {v.hash === OTHER_HASH
            ? <p>Every variant past the top {rows.length - 1}, merged into one row.</p>
            : <ol className="grid gap-1">{v.activities.map((a, i) => <li key={i}><Mono>{a}</Mono></li>)}</ol>}
          <p>Fitness against the reference: <Pill tone={fitnessTone(v.fitness)}>{fmtFitness(v.fitness)}</Pill></p>
          {canExport && v.sample_case_ids.length > 0 && (
            <section className="grid gap-1">
              <h2 className="font-semibold">Sample cases</h2>
              <ul className="flex flex-wrap gap-2">
                {v.sample_case_ids.map((id) => (
                  <li key={id}><Button variant="ghost" onClick={() => onOpenCase(id)}><Mono>{id}</Mono></Button></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )} />
  );
}
