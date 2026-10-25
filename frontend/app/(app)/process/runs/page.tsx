"use client";

/** Process › Discovery runs (process-discovery spec §7.3): every run on the system, live stage, New run. */
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Button, ErrorState, Notice } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { ACTIVE_RUN, getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { ProcessFrame, RowsSkeleton } from "../_components/process-header";
import { NewRunDialog } from "../_components/new-run-dialog";
import { NoSystem, RunsTable, SystemSelect, useProcessSystem } from "../_components/shared";

export default function ProcessRunsPage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs, active } = useJobs();
  const [newRun, setNewRun] = useUrlState("new", "");
  const runs = useQuery({
    queryKey: queryKeys.processRuns(system?.id ?? ""),
    queryFn: () => listRuns(system!.id, { limit: 200 }),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE_RUN.has(r.status)) ? 5_000 : false),
  });
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system,
  });
  const names = new Map((catalogue.data ?? []).map((r) => [r.l1, r.name]));

  if (systems.isError) return <ProcessFrame><ErrorState {...apiErrorState(systems.error)} onRetry={() => systems.refetch()} /></ProcessFrame>;
  if (systems.isSuccess && !system) return <ProcessFrame><NoSystem /></ProcessFrame>;
  if (!system) return <ProcessFrame><PageHeader title="Discovery runs" /><RowsSkeleton /></ProcessFrame>;
  const extraction = active.find((j) => j.kind === "extraction" && j.system_id === system.id);
  return (
    <ProcessFrame>
      <PageHeader title="Discovery runs" meta={system.name}
        actions={(
          <>
            <SystemSelect value={system.id} onValueChange={setSystem} systems={list} />
            {can("run_process_discovery") && <Button onClick={() => setNewRun("1")} disabled={!catalogue.data}>New run</Button>}
          </>
        )} />
      {extraction && (
        <Notice tone="info" title={`Waiting for extraction ${extraction.label} to finish.`}>
          Discovery runs queued on {system.name} start once this extraction completes.
        </Notice>
      )}
      {runs.isError
        ? <ErrorState {...apiErrorState(runs.error)} onRetry={() => runs.refetch()} />
        : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} names={names} /> : <RowsSkeleton />}
      {catalogue.data && (
        <NewRunDialog open={newRun === "1"} onOpenChange={(o) => setNewRun(o ? "1" : "")}
          systemId={system.id} systemName={system.name} rows={catalogue.data} />
      )}
    </ProcessFrame>
  );
}
