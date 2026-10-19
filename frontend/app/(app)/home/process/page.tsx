"use client";

/** Process analyst home (process-discovery spec §7.2): coverage, conformance, latest runs. */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, ErrorState, PageHeader, Skeleton, StatSkeleton, Stat, type StatTone, PageFrame } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { getCatalogue, listRuns, type CatalogueRow } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import {
  NoSystem, RunsTable, SystemSelect, fitnessTone, fmtCount, fmtFitness, l1Href, headline, useProcessSystem,
} from "../../process/_components/shared";
import { CoveragePill } from "../../process/_components/coverage-pill";


const columns = (systemId: string, canRun: boolean): ColumnDef<CatalogueRow>[] => [
  { id: "process", header: "Process", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <DrillLink href={l1Href(r.l1, systemId, r.last_run?.id)}>{r.name}</DrillLink> },
  { id: "coverage", header: "Coverage", cell: ({ row: { original: r } }) => <CoveragePill coverage={r.coverage} /> },
  { id: "fitness", header: "Fitness", meta: { numeric: true }, accessorFn: (r) => r.last_run?.fitness ?? -1, cell: ({ row: { original: r } }) => fmtFitness(r.last_run?.fitness) },
  { id: "variants", header: "Variants", meta: { numeric: true }, accessorFn: (r) => r.last_run?.variants ?? -1, cell: ({ row: { original: r } }) => fmtCount(r.last_run?.variants) },
  { id: "cases", header: "Cases", meta: { numeric: true }, accessorFn: (r) => r.last_run?.cases ?? -1, cell: ({ row: { original: r } }) => fmtCount(r.last_run?.cases) },
  { id: "last", header: "Last run", cell: ({ row: { original: r } }) => (r.last_run?.finished_at ? relativeTime(r.last_run.finished_at) : "Never") },
  {
    id: "run", header: "", enableSorting: false,
    cell: ({ row: { original: r } }) => canRun && r.coverage !== "reference" && !r.in_progress
      ? <Button variant="ghost" render={<Link href={`/process/runs?system=${systemId}&new=1&l1=${r.l1}`}>Run discovery</Link>} /> : null,
  },
];

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

  const framed = (node: React.ReactNode) => <PageFrame>{node}</PageFrame>;
  if (systems.isError) return framed(<ErrorState {...apiErrorState(systems.error)} onRetry={() => systems.refetch()} />);
  if (systems.isSuccess && !system) return framed(<NoSystem />);
  if (catalogue.isError) return framed(<ErrorState {...apiErrorState(catalogue.error)} onRetry={() => catalogue.refetch()} />);
  const rows = catalogue.data;
  if (!rows || !system) {
    return (
      <PageFrame data-testid="home-loading">
        <Skeleton height={26} width={160} />
        <Skeleton height={112} />
        <div className="grid grid-cols-2 gap-4"><StatSkeleton /><StatSkeleton /></div>
        <Skeleton height={240} />
      </PageFrame>
    );
  }
  const h = headline(rows);
  const catalogueHref = `/process?system=${system.id}`;
  return (
    <PageFrame>
      <PageHeader title="Home" meta={`${system.name}, ${rows.length} processes`} actions={<SystemSelect value={system.id} onValueChange={setSystem} systems={list} />} />
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Processes discovered" value={`${h.discovered} of ${rows.length}`} href={catalogueHref} />
        <Stat label="Median fitness" help="fitness" value={fmtFitness(h.fitness)}
          tone={h.fitness == null ? undefined : (fitnessTone(h.fitness) as StatTone)} />
      </div>
      <Card title="Processes" padding="sm">
        <DataTable columns={columns(system.id, can("run_process_discovery"))} data={rows} getRowId={(r) => r.l1} height="auto" dense hideToolbar tableId="home-processes" />
      </Card>
      <HomeOnboarding />
      <Card title="Latest runs">
        {runs.isError
          ? <ErrorState {...apiErrorState(runs.error)} onRetry={() => runs.refetch()} />
          : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} hideToolbar /> : <Skeleton height={120} />}
      </Card>
    </PageFrame>
  );
}
