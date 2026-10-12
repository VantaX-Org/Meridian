"use client";

/** Process › As-is processes: one row per L1 for the chosen system (process-discovery spec §7.3, §7.4). */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Button, ErrorState, InsightHeader } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getCatalogue } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { ProcessSkeleton } from "./_components/process-header";
import { CatalogueTable, NoSystem, SystemSelect, processInsight, useProcessSystem } from "./_components/shared";

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

  const frame = "mx-auto grid w-full gap-4";
  const pad = { padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" };
  if (systems.isError) return <div className={frame} style={pad}><ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} /></div>;
  if (systems.isSuccess && !system) return <div className={frame} style={pad}><NoSystem /></div>;
  if (catalogue.isError) return <div className={frame} style={pad}><ErrorState message={apiErrorMessage(catalogue.error)} onRetry={() => catalogue.refetch()} /></div>;
  const rows = catalogue.data;
  return (
    <div className={frame} style={pad}>
      <PageHeader title="Processes" meta={system?.name}
        actions={system && (
          <>
            <SystemSelect value={system.id} onValueChange={setSystem} systems={list} />
            {can("run_process_discovery") && (
              <Button render={<Link href={`/process/runs?system=${system.id}&new=1`}>Run discovery</Link>} />
            )}
          </>
        )} />
      {rows && system ? (
        <>
          <InsightHeader {...processInsight(rows, system.name, system.id, can("run_process_discovery"))} />
          <CatalogueTable rows={rows} systemId={system.id} jobs={jobs} />
        </>
      ) : <ProcessSkeleton />}
    </div>
  );
}
