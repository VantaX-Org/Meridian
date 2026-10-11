"use client";

/** Process › As-is processes: one card per L1 for the chosen system (process-discovery spec §7.3, §7.4). */
import { useQuery } from "@tanstack/react-query";
import { ErrorState, InsightHeader, Skeleton } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getCatalogue } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { CatalogueGrid, NoSystem, SystemSelect, processInsight, useProcessSystem } from "./_components/shared";

export default function ProcessCataloguePage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => r.in_progress) ? 5_000 : false),
  });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  if (catalogue.isError) return <ErrorState message={apiErrorMessage(catalogue.error)} onRetry={() => catalogue.refetch()} />;
  const rows = catalogue.data;
  return (
    <div className="grid gap-4">
      {rows && system
        ? <InsightHeader {...processInsight(rows, system.name, system.id, can("run_process_discovery"))} />
        : <InsightHeader loading situation={{ sentence: "" }} changed={{ sentence: "" }} why={{ sentence: "" }} next={{ sentence: "" }} />}
      <div className="max-w-xs">
        {system && <SystemSelect value={system.id} onValueChange={setSystem} systems={list} />}
      </div>
      {rows && system ? <CatalogueGrid rows={rows} systemId={system.id} jobs={jobs} /> : <Skeleton height={240} />}
    </div>
  );
}
