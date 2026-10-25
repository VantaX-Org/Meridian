"use client";

/** Process owner home (process-discovery spec §7.2): can each L1 run, the blocking rule, coverage and the latest runs. */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, ErrorState, Mono, PageHeader, Skeleton, StatSkeleton, Stat, Status, type StatTone, PageFrame } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { useProcessReadiness, type L1Readiness } from "@/components/process/shared";
import { getCatalogue, listRuns, type CatalogueRow } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import {
  NoSystem, RunsTable, SystemSelect, fitnessTone, fmtFitness, l1Href, headline, useProcessSystem,
} from "../../process/_components/shared";
import { CoveragePill } from "../../process/_components/coverage-pill";

type Row = CatalogueRow & { readiness: L1Readiness | undefined };

const columns = (systemId: string, canRun: boolean): ColumnDef<Row>[] => [
  { id: "process", header: "Process", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => (
      <span className="flex items-baseline gap-2"><DrillLink href={l1Href(r.l1, systemId, r.last_run?.id)}>{r.name}</DrillLink><Mono>{r.l1}</Mono></span>) },
  { id: "verdict", header: "Verdict", accessorFn: (r) => r.readiness?.verdict ?? "",
    cell: ({ row: { original: r } }) => (r.readiness ? <Status kind="verdict" value={r.readiness.verdict} variant="solid" /> : "—") },
  { id: "rule", header: "Blocking rule", enableSorting: false, cell: ({ row: { original: r } }) => {
      const w = r.readiness?.worst;
      if (!r.readiness) return "—";
      return w ? <span className="flex items-baseline gap-2"><Mono>{w.check_id ?? w.field}</Mono><span className="line-clamp-1">{w.description}</span></span> : "None";
    } },
  { id: "failing", header: "Failing records", meta: { numeric: true }, accessorFn: (r) => r.readiness?.failing ?? -1,
    cell: ({ row: { original: r } }) => (r.readiness ? r.readiness.failing.toLocaleString() : "—") },
  { id: "coverage", header: "Coverage", cell: ({ row: { original: r } }) => <CoveragePill coverage={r.coverage} /> },
  { id: "fitness", header: "Fitness", meta: { numeric: true }, accessorFn: (r) => r.last_run?.fitness ?? -1, cell: ({ row: { original: r } }) => fmtFitness(r.last_run?.fitness) },
  { id: "last", header: "Last run", cell: ({ row: { original: r } }) => (r.last_run?.finished_at ? relativeTime(r.last_run.finished_at) : "Never") },
  {
    id: "actions", header: "", enableSorting: false,
    cell: ({ row: { original: r } }) => (
      <span className="flex items-center gap-1">
        {r.readiness && <Button variant="ghost" render={<Link href={`/insights/process?l1=${encodeURIComponent(r.l1)}`}>Can it run</Link>} />}
        {canRun && r.coverage !== "reference" && !r.in_progress
          && <Button variant="ghost" render={<Link href={`/process/runs?system=${systemId}&new=1&l1=${r.l1}`}>Run discovery</Link>} />}
      </span>
    ),
  },
];

export default function ProcessHomePage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  const readiness = useProcessReadiness();
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
  if (!rows || !system || readiness.isLoading) {
    return (
      <PageFrame data-testid="home-loading">
        <Skeleton height={26} width={160} />
        <Skeleton height={240} />
        <div className="grid grid-cols-2 gap-4"><StatSkeleton /><StatSkeleton /></div>
        <Skeleton height={112} />
      </PageFrame>
    );
  }
  const h = headline(rows);
  const ledger: Row[] = rows.map((r) => ({ ...r, readiness: readiness.byL1.get(r.l1) }));
  const noGo = ledger.filter((r) => r.readiness?.verdict === "no-go").length;
  // The catalogue ranks lowest fitness first, so the tile lands on the ranked list.
  const catalogueHref = `/process?system=${system.id}`;
  return (
    <PageFrame>
      {/* "View as" (persona preview) select is added to these actions by the shell work; keep the fragment. */}
      <PageHeader title="Home" meta={`${system.name}, ${rows.length} processes`}
        actions={<><SystemSelect value={system.id} onValueChange={setSystem} systems={list} /></>} />
      <Card title="Can each process run" padding="sm"
        meta={readiness.latest ? `${noGo} of ${readiness.byL1.size} scored processes no-go` : "No finished analysis to score readiness from"}>
        <DataTable columns={columns(system.id, can("run_process_discovery"))} data={ledger} getRowId={(r) => r.l1} height="auto" dense hideToolbar tableId="home-processes" />
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Processes discovered" value={`${h.discovered} of ${rows.length}`} href={catalogueHref} />
        <Stat label="Median fitness" help="fitness" value={fmtFitness(h.fitness)} href={catalogueHref}
          tone={h.fitness == null ? undefined : (fitnessTone(h.fitness) as StatTone)} />
      </div>
      <HomeOnboarding />
      <Card title="Latest runs">
        {runs.isError
          ? <ErrorState {...apiErrorState(runs.error)} onRetry={() => runs.refetch()} />
          : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} names={new Map(rows.map((r) => [r.l1, r.name]))} hideToolbar /> : <Skeleton height={120} />}
      </Card>
    </PageFrame>
  );
}
