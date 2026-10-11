"use client";

/** Process analyst home (process-discovery spec §7.2): coverage, conformance, latest runs. */
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorState, InsightHeader, Skeleton, Stat, type StatTone } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import {
  CatalogueGrid, NoSystem, RunsTable, SystemSelect, fitnessTone, fmtFitness, headline, processInsight, useProcessSystem,
} from "../../process/_components/shared";

export default function ProcessHomePage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => r.in_progress) ? 5_000 : false),
  });
  const runs = useQuery({
    queryKey: queryKeys.processRuns(system?.id ?? ""),
    queryFn: () => listRuns(system!.id, { limit: 5 }),
    enabled: !!system,
  });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  if (catalogue.isError) return <ErrorState message={apiErrorMessage(catalogue.error)} onRetry={() => catalogue.refetch()} />;
  const rows = catalogue.data;
  if (!rows || !system) return <Skeleton height={320} />;
  const h = headline(rows);
  const catalogueHref = `/process?system=${system.id}`;
  return (
    <div className="grid gap-4">
      <InsightHeader {...processInsight(rows, system.name, system.id, can("run_process_discovery"))} />
      <div className="max-w-xs"><SystemSelect value={system.id} onValueChange={setSystem} systems={list} /></div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Processes discovered" value={`${h.discovered} of ${rows.length}`} href={catalogueHref} />
        <Stat label="Median fitness" value={fmtFitness(h.fitness)}
          tone={h.fitness == null ? undefined : (fitnessTone(h.fitness) as StatTone)} />
      </div>
      <CatalogueGrid rows={rows} systemId={system.id} jobs={jobs} />
      <Card title="Latest runs">
        {runs.isError
          ? <ErrorState message={apiErrorMessage(runs.error)} onRetry={() => runs.refetch()} />
          : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} hideToolbar /> : <Skeleton height={120} />}
      </Card>
    </div>
  );
}
