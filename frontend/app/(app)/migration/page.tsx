"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { toast } from "sonner";
import Link from "next/link";
import { DrillLink, Button, DataTable, ExplorerPage, FilterChip, PageHeader, Pill, Sparkline, Stat, Status, asyncStateOf, statusLabel } from "@/design";
import { InsightTabs } from "@/app/(app)/insights/_components/InsightViews";
import { InsightActions } from "@/app/(app)/insights/_components/InsightActions";
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
      toast.success("Run queued, readiness updates when it completes");
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
      toast.success("Dry run queued");
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
      id: "actions", header: "", size: 340,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          {can("analyse") ? (
            <>
              <Button variant="ghost" size="sm" disabled={run.isPending}
                      onClick={(e) => { e.stopPropagation(); run.mutate(row.original.id); }}>
                Run now
              </Button>
              <Button variant="ghost" size="sm" disabled={dryRun.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (row.original.source_system_id) dryRun.mutate(row.original);
                        else toast.error("Set a source system for this wave first. Open the wave to edit it");
                      }}>
                Dry run (S/4 load)
              </Button>
            </>
          ) : null}
          <Link href={`/migration/${row.original.id}`} className="m-ink-accent-ink underline" onClick={(e) => e.stopPropagation()}>Open</Link>
        </div>
      ),
    },
  ];

  const data = waves.data ?? [];
  const verdictOf = (w: MigrationWave) => (w.last_verdict ? FROM_ENGINE[w.last_verdict] : null);
  const goWaves = data.filter((w) => verdictOf(w) === "go");
  const atRiskWaves = data.filter((w) => verdictOf(w) === "at_risk");
  const noGoWaves = data.filter((w) => verdictOf(w) === "no_go");
  const verdict = rawVerdict === "go" || rawVerdict === "at_risk" || rawVerdict === "no_go" ? rawVerdict : "";
  const VERDICT_RANK: Record<string, number> = { no_go: 0, at_risk: 1, go: 2 };
  // Worst first, then the lowest readiness: the waves that need a hand lead the ledger.
  const shownWaves = (verdict ? data.filter((w) => verdictOf(w) === verdict) : data).sort((a, b) =>
    (VERDICT_RANK[verdictOf(a) ?? ""] ?? 3) - (VERDICT_RANK[verdictOf(b) ?? ""] ?? 3) || (a.last_score ?? 101) - (b.last_score ?? 101));
  const [goCount, atRiskCount, noGoCount] = [goWaves.length, atRiskWaves.length, noGoWaves.length];
  const createButton = can("analyse") ? <Button onClick={() => setCreating(true)}>Create wave</Button> : undefined;
  return (
    <>
      <ExplorerPage
        header={<PageHeader title="Migration" meta={`${waves.isPending ? "" : `${data.length} ${data.length === 1 ? "wave" : "waves"}. `}Whether each group of objects is ready to load into S/4HANA, worst first. Run a wave to refresh its readiness`} actions={<><InsightActions />{createButton}</>} tabs={<InsightTabs />} />}
        summary={data.length > 0 ? (
          <div className="m-stat-grid">
            <Stat label="Waves" help="wave" value={data.length} />
            <Stat label="Go" value={goCount} tone="go" href="/migration?verdict=go" />
            <Stat label="At risk" value={atRiskCount} tone={atRiskCount > 0 ? "at-risk" : undefined} href="/migration?verdict=at_risk" />
            <Stat label="No-go" value={noGoCount} tone={noGoCount > 0 ? "no-go" : undefined} href="/migration?verdict=no_go" />
          </div>
        ) : undefined}
        filterBar={
          verdict ? (
            <div className="flex items-center gap-2 m-text-body">
              <FilterChip label="Verdict" value={statusLabel("verdict", verdict)} onRemove={() => setVerdict("")} />
            </div>
          ) : undefined
        }
        table={<DataTable columns={columns} data={shownWaves} getRowId={(w) => w.id}
                          onRowClick={(w) => router.push(`/migration/${w.id}`)} />}
        state={asyncStateOf(waves, () => data.length === 0, true)}
        emptyProps={{
          title: "No waves yet",
          detail: createButton
            ? "A wave groups the objects you move to S/4HANA together, so you can see whether they are ready to load."
            : "A wave groups the objects you move to S/4HANA together. Ask an analyst to create the first one.",
          action: createButton,
        }}
        errorProps={{ error: waves.error, onRetry: () => void waves.refetch() }}
      />
      <CreateWaveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
