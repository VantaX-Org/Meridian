"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, EmptyState, ErrorState, Mono, Skeleton, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { createBlockerFixBatch, getMigrationFindings } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationGapFinding, WaveBlocker } from "@/types/api";

const GAP_COLUMNS: ColumnDef<MigrationGapFinding>[] = [
  { id: "key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key ?? "All records"}</Mono> },
  { id: "src", header: "Source value", cell: ({ row }) => row.original.source_value ?? "—" },
  { id: "detail", header: "Detail", cell: ({ row }) => row.original.detail ?? "—" },
];

/**
 * `runId` is the migration run (its gap list); `versionId` the analysis version it scored, which the records drill
 * opens (null: the count is plain text). `runAction` is the cockpit's Run now, absent without the analyse permission.
 */
export function BlockersTab({ waveId, runId, versionId, blockers, runAction }: { waveId: string; runId: string | null; versionId: string | null; blockers: WaveBlocker[]; runAction?: ReactNode }) {
  const { can } = useRole();
  const [open, setOpen] = useState<WaveBlocker | null>(null);
  const filter = open ? { module: open.module, gap_type: open.gap_type, search: open.field ?? undefined } : {};
  const gaps = useQuery({
    queryKey: queryKeys.migrationGaps(runId ?? "", filter),
    queryFn: () => getMigrationFindings(runId ?? "", { ...filter, limit: 100 }),
    enabled: open !== null && runId !== null,
  });
  const fix = useMutation({
    mutationFn: (b: WaveBlocker) => createBlockerFixBatch(waveId, { module: b.module, gap_type: b.gap_type, field: b.field }),
    onSuccess: () => toast.success("Fix batch drafted. Review it under Fix before it is applied."),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: ColumnDef<WaveBlocker>[] = [
    { id: "object", header: "Object", accessorFn: (b) => formatModuleName(b.module) },
    { id: "gap", header: "Gap", cell: ({ row }) => formatModuleName(row.original.gap_type) },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field ?? "—"}</Mono> },
    { id: "sev", header: "Severity", cell: ({ row }) => (
        <Status kind="severity" value={row.original.severity} />) },
    { id: "records", header: "Records", cell: ({ row }) => (
        versionId
          ? <DrillLink href={`/objects/${row.original.module}?run=${versionId}&tab=records`}>{row.original.records.toLocaleString()}</DrillLink>
          : row.original.records.toLocaleString()
      ) },
    { id: "fix", header: "", cell: ({ row }) => can("apply") ? (
        <Button variant="secondary" disabled={fix.isPending}
                onClick={(e) => { e.stopPropagation(); fix.mutate(row.original); }}>Create fix batch</Button>
      ) : null },
  ];

  if (!runId) return <EmptyState title="Not run yet" detail="Run this wave to see its blockers." action={runAction} />;
  if (!blockers.length) {
    return <EmptyState title="No blockers" detail="The latest run found no critical or high gaps. Run the wave again after the next data change." action={runAction} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="m-text-body m-ink-2">Gaps that stop records from loading, most records first. Open one to see the records, or draft a fix batch for it.</p>
      <DataTable columns={columns} data={blockers} getRowId={(b) => `${b.module}|${b.gap_type}|${b.field ?? ""}`}
                 onRowClick={setOpen} />
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="m-text-body font-semibold m-ink">
            {formatModuleName(open.module)}: {formatModuleName(open.gap_type)} {open.field ?? ""}
          </p>
          {gaps.isLoading ? <Skeleton height={160} /> : gaps.isError ? (
            <ErrorState {...apiErrorState(gaps.error)} onRetry={() => void gaps.refetch()} />
          ) : (
            <DataTable columns={GAP_COLUMNS} data={gaps.data?.items ?? []}
                       getRowId={(g) => `${g.record_key ?? ""}|${g.target_field ?? ""}|${g.source_value ?? ""}`} />
          )}
        </div>
      ) : null}
    </div>
  );
}
