"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { toast } from "sonner";
import { DrillLink, Button, DataTable, ExplorerPage, PageHeader, Pill, Sparkline, Stat, Status, asyncStateOf } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/error";
import { getWaves, runWave, startMigration } from "@/lib/api/migration";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationWave, TransferVerdict, WaveVerdict } from "@/types/api";
import { CreateWaveDialog, STAGE_LABEL } from "./create-wave-dialog";

const FROM_ENGINE: Record<TransferVerdict, WaveVerdict> = { go: "go", conditional: "at_risk", "no-go": "no_go" };

export default function MigrationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [creating, setCreating] = useState(false);
  const [rawVerdict, setVerdict] = useUrlState("verdict", "");
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
        return v ? <Status kind="verdict" value={v} /> : <Pill>Not run</Pill>;
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
  const verdict = rawVerdict === "go" || rawVerdict === "at_risk" || rawVerdict === "no_go" ? rawVerdict : "";
  const shownWaves = verdict ? data.filter((w) => verdictOf(w) === verdict) : data;
  const [goCount, atRiskCount, noGoCount] = [goWaves.length, atRiskWaves.length, noGoWaves.length];
  const createButton = can("analyse") ? <Button onClick={() => setCreating(true)}>Create wave</Button> : undefined;
  return (
    <>
      <ExplorerPage
        header={<PageHeader title="Migration" meta={waves.isPending ? "\u00a0" : `${data.length} ${data.length === 1 ? "wave" : "waves"}`} actions={createButton} />}
        summary={data.length > 0 ? (
          <div className="m-stat-grid">
            <Stat label="Waves" help="wave" value={data.length} />
            <Stat label="Go" value={goCount} tone="go" href="/migration?verdict=go" />
            <Stat label="At risk" value={atRiskCount} tone={atRiskCount > 0 ? "at-risk" : undefined} href="/migration?verdict=at_risk" />
            <Stat label="No go" value={noGoCount} tone={noGoCount > 0 ? "no-go" : undefined} href="/migration?verdict=no_go" />
          </div>
        ) : undefined}
        filterBar={
          <div className="flex items-center justify-between gap-2 m-text-body">
            {verdict ? (
              <span className="flex items-center gap-2">
                <span className="m-ink-2">Showing {verdict.replace("_", " ")} waves.</span>
                <Button variant="secondary" onClick={() => setVerdict("")}>Show all waves</Button>
              </span>
            ) : <span />}
          </div>
        }
        table={<DataTable columns={columns} data={shownWaves} getRowId={(w) => w.id}
                          onRowClick={(w) => router.push(`/migration/${w.id}`)} />}
        state={asyncStateOf(waves, () => data.length === 0, true)}
        emptyProps={{ title: "No migration waves yet. Create one to track readiness.", action: createButton }}
        errorProps={{ message: apiErrorMessage(waves.error), onRetry: () => void waves.refetch() }}
      />
      <CreateWaveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
