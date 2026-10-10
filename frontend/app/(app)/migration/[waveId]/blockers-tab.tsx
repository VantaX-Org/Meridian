"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Mono, Pill } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { createBlockerFixBatch, getMigrationFindings } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationGapFinding, WaveBlocker } from "@/types/api";

const GAP_COLUMNS: ColumnDef<MigrationGapFinding>[] = [
  { id: "key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key ?? "All records"}</Mono> },
  { id: "src", header: "Source value", cell: ({ row }) => row.original.source_value ?? "—" },
  { id: "detail", header: "Detail", cell: ({ row }) => row.original.detail ?? "—" },
];

export function BlockersTab({ waveId, runId, blockers }: { waveId: string; runId: string | null; blockers: WaveBlocker[] }) {
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
    onSuccess: () => toast.success("Fix batch drafted. Review it under Cleaning."),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: ColumnDef<WaveBlocker>[] = [
    { accessorKey: "label", header: "Object" },
    { id: "gap", header: "Gap", cell: ({ row }) => formatModuleName(row.original.gap_type) },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field ?? "—"}</Mono> },
    { id: "sev", header: "Severity", cell: ({ row }) => (
        <Pill tone={row.original.severity === "critical" ? "no-go" : "at-risk"}>{formatModuleName(row.original.severity)}</Pill>) },
    { id: "records", header: "Records", cell: ({ row }) => row.original.records.toLocaleString() },
    { id: "fix", header: "", cell: ({ row }) => can("apply") ? (
        <Button variant="secondary" disabled={fix.isPending}
                onClick={(e) => { e.stopPropagation(); fix.mutate(row.original); }}>Create fix batch</Button>
      ) : null },
  ];

  if (!runId) return <EmptyState title="Run this wave to see its blockers." />;
  if (!blockers.length) return <EmptyState title="The latest run found no critical or high gaps." />;
  return (
    <div className="flex flex-col gap-4">
      <DataTable columns={columns} data={blockers} getRowId={(b) => `${b.module}|${b.gap_type}|${b.field ?? ""}`}
                 onRowClick={setOpen} />
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold" style={{ color: "var(--m-ink)" }}>
            {open.label}: {formatModuleName(open.gap_type)} {open.field ?? ""}
          </p>
          <DataTable columns={GAP_COLUMNS} data={gaps.data?.items ?? []}
                     getRowId={(g) => `${g.record_key ?? ""}|${g.target_field ?? ""}|${g.source_value ?? ""}`} />
        </div>
      ) : null}
    </div>
  );
}
