"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Pill, Sparkline, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { getWaves, runWave } from "@/lib/api/migration";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationWave, TransferVerdict, WaveVerdict } from "@/types/api";
import { CreateWaveDialog, STAGE_LABEL } from "./create-wave-dialog";

export const VERDICT_TONE: Record<WaveVerdict, PillTone> = { go: "go", at_risk: "at-risk", no_go: "no-go" };
export const VERDICT_LABEL: Record<WaveVerdict, string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };
const FROM_ENGINE: Record<TransferVerdict, WaveVerdict> = { go: "go", conditional: "at_risk", "no-go": "no_go" };

export default function MigrationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [creating, setCreating] = useState(false);
  const waves = useQuery({ queryKey: queryKeys.migrationWaves(), queryFn: getWaves });
  const run = useMutation({
    mutationFn: (id: string) => runWave(id),
    onSuccess: () => {
      toast.success("Run queued. Readiness updates when it completes.");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: ColumnDef<MigrationWave>[] = [
    { accessorKey: "name", header: "Wave" },
    { id: "stage", header: "Stage", cell: ({ row }) => STAGE_LABEL[row.original.stage] },
    {
      id: "date", header: "Target date",
      cell: ({ row }) => (row.original.target_date ? formatDate(row.original.target_date, "date") : "Not set"),
    },
    {
      id: "verdict", header: "Verdict",
      cell: ({ row }) => {
        const v = row.original.last_verdict ? FROM_ENGINE[row.original.last_verdict] : null;
        return v ? <Pill tone={VERDICT_TONE[v]}>{VERDICT_LABEL[v]}</Pill> : <Pill>Not run</Pill>;
      },
    },
    {
      id: "score", header: "Readiness",
      cell: ({ row }) => (row.original.last_score == null ? "—" : `${row.original.last_score.toFixed(1)}%`),
    },
    {
      id: "trend", header: "Trend",
      cell: ({ row }) => <Sparkline data={(row.original.trend ?? []).map((y, x) => ({ x, y }))} />,
    },
    {
      id: "actions", header: "",
      cell: ({ row }) =>
        can("analyse") ? (
          <Button variant="secondary" disabled={run.isPending}
                  onClick={(e) => { e.stopPropagation(); run.mutate(row.original.id); }}>
            Run now
          </Button>
        ) : null,
    },
  ];

  const data = waves.data ?? [];
  const createButton = can("analyse") ? <Button onClick={() => setCreating(true)}>Create wave</Button> : undefined;
  return (
    <>
      <ExplorerPage
        filterBar={<div className="flex justify-end">{createButton}</div>}
        table={<DataTable columns={columns} data={data} getRowId={(w) => w.id}
                          onRowClick={(w) => router.push(`/migration/${w.id}`)} />}
        state={waves.isPending ? "loading" : waves.isError ? "error" : data.length === 0 ? "empty" : undefined}
        emptyProps={{ title: "No migration waves yet. Create one to track readiness.", action: createButton }}
        errorProps={{ message: apiErrorMessage(waves.error), onRetry: () => void waves.refetch() }}
      />
      <CreateWaveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
