"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DrillLink, Button, DataTable, ExplorerPage, Pill, Sparkline, Stat, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { getWaves, runWave, startMigration } from "@/lib/api/migration";
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
  const dryRun = useMutation({
    mutationFn: (wave: MigrationWave) =>
      startMigration({
        mode: "s4_dry_run",
        source_system_id: wave.source_system_id as string,
        modules: wave.modules,
      }),
    onSuccess: (data) => {
      toast.success("Dry run queued.");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
      router.push(`/migration/dry-run?run=${data.run_id}`);
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
      cell: ({ row }) => (row.original.last_score == null ? "—" : <DrillLink href={`/migration/${row.original.id}`}>{`${row.original.last_score.toFixed(1)}%`}</DrillLink>),
    },
    {
      id: "trend", header: "Trend",
      cell: ({ row }) => <Sparkline data={(row.original.trend ?? []).map((y, x) => ({ x, y }))} />,
    },
    {
      id: "actions", header: "",
      cell: ({ row }) =>
        can("analyse") ? (
          <div className="flex gap-2">
            <Button variant="secondary" disabled={run.isPending}
                    onClick={(e) => { e.stopPropagation(); run.mutate(row.original.id); }}>
              Run now
            </Button>
            <Button variant="secondary" disabled={dryRun.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (row.original.source_system_id) dryRun.mutate(row.original);
                      else toast.error("Set a source system for this wave first.");
                    }}>
              Dry run (S/4 load)
            </Button>
          </div>
        ) : null,
    },
  ];

  const data = waves.data ?? [];
  const verdictOf = (w: MigrationWave) => (w.last_verdict ? FROM_ENGINE[w.last_verdict] : null);
  const goWaves = data.filter((w) => verdictOf(w) === "go");
  const atRiskWaves = data.filter((w) => verdictOf(w) === "at_risk");
  const noGoWaves = data.filter((w) => verdictOf(w) === "no_go");
  const [firstGo, firstAtRisk, firstNoGo] = [goWaves[0], atRiskWaves[0], noGoWaves[0]];
  const [goCount, atRiskCount, noGoCount] = [goWaves.length, atRiskWaves.length, noGoWaves.length];
  const createButton = can("analyse") ? <Button onClick={() => setCreating(true)}>Create wave</Button> : undefined;
  return (
    <>
      <ExplorerPage
        summary={data.length > 0 ? (
          <div className="flex flex-wrap gap-6">
            <Stat label="Waves" value={data.length} href={`/migration/${data[0].id}`} />
            <Stat label="Go" value={goCount} tone="go" href={firstGo ? `/migration/${firstGo.id}` : undefined} />
            <Stat label="At risk" value={atRiskCount} tone={atRiskCount > 0 ? "at-risk" : undefined} href={firstAtRisk ? `/migration/${firstAtRisk.id}` : undefined} />
            <Stat label="No go" value={noGoCount} tone={noGoCount > 0 ? "no-go" : undefined} href={firstNoGo ? `/migration/${firstNoGo.id}` : undefined} />
          </div>
        ) : undefined}
        filterBar={<div className="flex justify-end">{createButton}</div>}
        table={<DataTable columns={columns} data={data} getRowId={(w) => w.id}
                          onRowClick={(w) => router.push(`/migration/${w.id}`)} />}
        state={waves.isPending ? "loading" : isListFailure(waves) ? "error" : data.length === 0 ? "empty" : undefined}
        emptyProps={{ title: "No migration waves yet. Create one to track readiness.", action: createButton }}
        errorProps={{ message: apiErrorMessage(waves.error), onRetry: () => void waves.refetch() }}
      />
      <CreateWaveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
