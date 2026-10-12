"use client";

/** Process › Discovery runs (process-discovery spec §7.3): every run on the system, live stage, New run. */
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, Notice } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { ACTIVE_RUN, getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { ProcessHeader, ProcessSkeleton, RowsSkeleton } from "../_components/process-header";
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
    enabled: !!system && can("run_process_discovery"),
  });

  const frame = "mx-auto grid w-full gap-4";
  const pad = { padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" };
  if (systems.isError) return <div className={frame} style={pad}><ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} /></div>;
  if (systems.isSuccess && !system) return <div className={frame} style={pad}><NoSystem /></div>;
  if (!system) return <div className={frame} style={pad}><ProcessSkeleton /></div>;
  const extraction = active.find((j) => j.kind === "extraction" && j.system_id === system.id);
  return (
    <div className={frame} style={pad}>
      <ProcessHeader title="Discovery runs" meta={system.name}
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
        ? <ErrorState message={apiErrorMessage(runs.error)} onRetry={() => runs.refetch()} />
        : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} /> : <RowsSkeleton />}
      {catalogue.data && (
        <NewRunDialog open={newRun === "1"} onOpenChange={(o) => setNewRun(o ? "1" : "")}
          systemId={system.id} systemName={system.name} rows={catalogue.data} />
      )}
    </div>
  );
}
