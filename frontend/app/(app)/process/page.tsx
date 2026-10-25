"use client";

/** Process › As-is processes: one row per L1 for the chosen system (process-discovery spec §7.3, §7.4). */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Button, ErrorState, InsightHeader, type InsightHeaderProps } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getCatalogue } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { BodySkeleton, PROCESS_PURPOSE, ProcessFrame, processMeta } from "./_components/process-header";
import { CatalogueTable, NoSystem, SystemSelect, processInsight, useProcessSystem } from "./_components/shared";

const noRun = (i: InsightHeaderProps): InsightHeaderProps =>
  i.next.action?.label.includes("discovery") ? { ...i, next: { sentence: i.next.sentence } } : i;

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

  if (systems.isError) return <ProcessFrame><ErrorState {...apiErrorState(systems.error)} onRetry={() => systems.refetch()} /></ProcessFrame>;
  if (systems.isSuccess && !system) return <ProcessFrame><NoSystem /></ProcessFrame>;
  if (catalogue.isError) return <ProcessFrame><ErrorState {...apiErrorState(catalogue.error)} onRetry={() => catalogue.refetch()} /></ProcessFrame>;
  const rows = catalogue.data;
  return (
    <ProcessFrame>
      <PageHeader title="As-is processes" meta={processMeta(PROCESS_PURPOSE.catalogue)}
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
          {/* The header already carries "Run discovery"; keep the sentence, drop the duplicate button. */}
          <InsightHeader {...noRun(processInsight(rows, system.name, system.id, can("run_process_discovery")))} />
          <CatalogueTable rows={rows} systemId={system.id} jobs={jobs} />
        </>
      ) : <BodySkeleton />}
    </ProcessFrame>
  );
}
