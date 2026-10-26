"use client";

/** Process owner home (process-discovery spec §7.2): can each L1 run, the blocking rule, coverage and the latest runs. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, actionColumn, buildDrillHref, Card, DataTable, DrillLink, ErrorState, ExportMenu, InsightHeader, Mono, PageHeader, Select, Skeleton, StatSkeleton, Stat, Status, type ExportOption, type StatTone, PageFrame, runExportOption } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { readinessHref, useProcessReadiness } from "@/components/process/shared";
import { HandToSteward } from "@/components/process/handoff";
import { exportRun, getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { downloadCsv } from "@/lib/actions";
import { apiErrorState } from "@/lib/error";
import { plural, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { PERSONA_OPTIONS } from "@/lib/persona";
import { hrefWithRun, runScopeLabel } from "@/lib/run-scope";
import {
  NoSystem, RunsTable, SystemSelect, fitnessTone, fmtFitness, l1Href, headline, useProcessSystem,
} from "../../process/_components/shared";
import { CoveragePill } from "../../process/_components/coverage-pill";
import { DiscoveryStart, canMine, isDayOne } from "../../process/_components/discovery-start";
import { processHomeInsight, readinessExportRows, worstNoGo, type ProcessHomeRow } from "./insight";

type Row = ProcessHomeRow;

const columns = (systemId: string, canRun: boolean, versionId: string | undefined): ColumnDef<Row>[] => [
  { id: "process", header: "Process", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => (
      <span className="flex items-baseline gap-2"><DrillLink href={l1Href(r.l1, systemId, r.last_run?.id)}>{r.name}</DrillLink><Mono>{r.l1}</Mono></span>) },
  { id: "verdict", header: "Verdict", accessorFn: (r) => r.readiness?.verdict ?? "",
    cell: ({ row: { original: r } }) => (r.readiness ? <Status kind="verdict" value={r.readiness.verdict} variant="solid" /> : <span className="m-ink-3">Not scored</span>) },
  { id: "rule", header: "Blocking rule", enableSorting: false, cell: ({ row: { original: r } }) => {
      const w = r.readiness?.worst;
      if (!r.readiness) return "—";
      if (!w) return "None";
      // The rule opens its failing records on the object that scored this process, in the run that scored it.
      const id = w.check_id
        ? <DrillLink href={buildDrillHref({ object: r.readiness.module, ruleId: w.check_id, run: versionId })}><Mono>{w.check_id}</Mono></DrillLink>
        : <Mono>{w.field}</Mono>;
      return <span className="flex items-baseline gap-2">{id}<span className="line-clamp-1">{w.description}</span></span>;
    } },
  { id: "failing", header: "Failing records", meta: { numeric: true }, accessorFn: (r) => r.readiness?.failing ?? -1,
    cell: ({ row: { original: r } }) => (r.readiness ? r.readiness.failing.toLocaleString() : "—") },
  { id: "coverage", header: "Coverage", cell: ({ row: { original: r } }) => <CoveragePill coverage={r.coverage} /> },
  { id: "fitness", header: "Fitness", meta: { numeric: true }, accessorFn: (r) => r.last_run?.fitness ?? -1, cell: ({ row: { original: r } }) => fmtFitness(r.last_run?.fitness) },
  { id: "last", header: "Last run", cell: ({ row: { original: r } }) => (r.last_run?.finished_at ? relativeTime(r.last_run.finished_at) : "Never") },
  {
    // A fixed, pinned action column wide enough for its buttons on one line: a narrow auto column wrapped them over
    // three lines, out of the fixed-height row and onto the header.
    ...actionColumn<Row>(() => null),
    size: 300,
    cell: ({ row: { original: r } }) => {
      // The object that scored this L1, in the run that scored it: the readiness page reads one object per run.
      const ready = r.readiness && readinessHref({ l1: r.l1, object: r.readiness.module, run: versionId });
      return (
        <span className="flex items-center gap-1 whitespace-nowrap">
          {ready && <Button variant="ghost" render={<Link href={ready}>Can it run</Link>} />}
          {r.readiness?.worst?.check_id && (
            <HandToSteward target={{ checkId: r.readiness.worst.check_id, module: r.readiness.module, versionId, process: r.name, field: r.readiness.worst.field }} />
          )}
          {canRun && r.coverage !== "reference" && !r.in_progress
            && <Button variant="ghost" render={<Link href={`/process/runs?system=${systemId}&new=1&l1=${r.l1}`}>Run discovery</Link>} />}
        </span>
      );
    },
  },
];

export default function ProcessHomePage() {
  const { can } = useRole();
  const router = useRouter();
  const search = useSearchParams();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  // Readiness follows the System picker: the newest finished run of that system, never another system's.
  const readiness = useProcessReadiness(systems.isSuccess ? system?.id ?? null : null);
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
        <div className="m-stat-grid"><StatSkeleton /><StatSkeleton /></div>
        <Skeleton height={112} />
      </PageFrame>
    );
  }
  const h = headline(rows);
  // Scored processes first (in catalogue order), then the ones no analysis scores yet.
  const ledger: Row[] = rows
    .map((r) => ({ ...r, readiness: readiness.byL1.get(r.l1) }))
    .sort((a, b) => Number(!a.readiness) - Number(!b.readiness));
  const noGo = ledger.filter((r) => r.readiness?.verdict === "no-go").length;
  const scoredCount = ledger.filter((r) => r.readiness).length;
  // The catalogue ranks lowest fitness first, so the tile lands on the ranked list.
  const catalogueHref = `/process?system=${system.id}`;
  const starting = isDayOne(rows) || !canMine(rows);
  // The as-is model to export: the worst no-go process's, else the first discovered one's (export_process).
  const worst = worstNoGo(ledger);
  const modelRow = worst?.last_run ? worst : ledger.find((r) => r.last_run);
  const modelRun = modelRow?.last_run;
  const modelExport: ExportOption | undefined = can("export_process") && modelRow && modelRun
    ? { format: "json", label: `${modelRow.name} as-is model (Signavio)`, run: () => exportRun(modelRun.id, modelRow.l1, {}) }
    : undefined;
  const readinessExport: ExportOption = {
    format: "csv", label: "Process readiness (CSV)",
    run: async () => downloadCsv(`process-readiness-${system.name}.csv`, readinessExportRows(ledger)),
  };
  // ExportMenu shows only to `export`; a process analyst holds export_process alone and gets the model as one button.
  const exportAction = can("export")
    ? <ExportMenu options={[readinessExport, ...(modelExport ? [modelExport] : [])]} />
    : modelExport ? <Button variant="secondary" onClick={() => void runExportOption(modelExport)}>Export</Button> : null;
  return (
    <PageFrame>
      <PageHeader title="Home" meta={`${system.name}, ${rows.length} processes`} actions={<>
        <SystemSelect value={system.id} onValueChange={setSystem} systems={list} />
        <Select
          label="View as"
          value="process"
          onValueChange={(r) => router.push(hrefWithRun(`/home/${r}`, search, search.get("run")))}
          options={PERSONA_OPTIONS}
        />
        {exportAction}
      </>} />
      {starting && <DiscoveryStart system={system} rows={rows} />}
      {/* After day one (or once an analysis scores the processes) the page leads with its verdict and next step. */}
      {(!starting || readiness.byL1.size > 0) && <InsightHeader {...processHomeInsight(ledger, system, readiness.latest)} />}
      <Card title="Can each process run" padding="sm"
        meta={readiness.latest
          ? `${scoredCount} of ${plural(rows.length, "process", "processes")} scored, ${noGo} no-go, from ${runScopeLabel(readiness.latest)} on ${system.name}`
          : `No finished analysis of ${system.name} to score readiness from`}>
        <DataTable columns={columns(system.id, can("run_process_discovery"), readiness.latest?.id)} data={ledger} getRowId={(r) => r.l1} height="auto" hideToolbar tableId="home-processes" />
      </Card>
      <div className="m-stat-grid">
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
