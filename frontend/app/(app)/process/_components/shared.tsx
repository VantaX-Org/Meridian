"use client";

/**
 * Pieces shared by the process home, the catalogue and the runs pages
 * (process-discovery spec §7.3): the `?system=` choice, the L1 cards,
 * the runs table and the InsightHeader sentences.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Card, DataTable, DrillLink, EmptyState, Mono, Pill, Select, type InsightHeaderProps, type PillTone,
} from "@/design";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/connectivity";
import { ACTIVE_RUN, type CatalogueRow, type DiscoveryRun } from "@/lib/api/process-discovery";
import { formatDuration } from "@/lib/job-timing";
import { relativeTime } from "@/lib/format";
import { useSystemScope } from "@/lib/permissions";
import { readinessHref } from "@/components/process/shared";
import { queryKeys } from "@/lib/query-keys";
import type { Job } from "@/types/jobs";
import { CoveragePill, RunStatusPill } from "./coverage-pill";
import { ASK_TO_RUN_DISCOVERY, NOT_MINABLE, canMine } from "./discovery-start";

export const fitnessTone = (f: number | null | undefined): PillTone =>
  f == null ? "neutral" : f >= 0.8 ? "go" : f >= 0.6 ? "at-risk" : "no-go";
export const fmtFitness = (f: number | null | undefined) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);
export const fmtSeconds = (s: number | null | undefined) => (s == null ? "—" : formatDuration(s));
export const fmtCount = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/**
 * Failing findings of the system's DQ run on the modules a process or step touches; "—" when unmapped or no DQ run.
 * The count covers this process's objects only, so it opens that L1's readiness in that run (never every no-go
 * object of the run); an L1 without a readiness definition has no page that lists just its objects, so its count
 * is plain text.
 */
export function DqDefects({ n, versionId, l1 }: { n: number | null | undefined; versionId: string | null | undefined; l1: string | undefined }) {
  if (n == null || versionId == null) return "—";
  const href = l1 ? readinessHref({ l1, run: versionId }) : undefined;
  return href ? <DrillLink href={href}>{n.toLocaleString()}</DrillLink> : n.toLocaleString();
}

/** The job's current stage label, else the run status. */
export function stageLabel(job: Job | undefined): string | null {
  if (!job?.stage) return null;
  return job.stages.find((s) => s.id === job.stage)?.label ?? job.stage;
}

/** `?system=`, defaulting to the first system the user's scope allows. */
export function useProcessSystem() {
  const scope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, select: scope });
  const [raw, setSystem] = useUrlState("system", "");
  const list = systems.data ?? [];
  const system = list.find((s) => s.id === raw) ?? list[0];
  return { systems, list, system, setSystem };
}

export function SystemSelect({ value, onValueChange, systems }: {
  value: string; onValueChange: (v: string) => void; systems: { id: string; name: string }[];
}) {
  return (
    <Select label="System" value={value} onValueChange={onValueChange}
      options={systems.map((s) => ({ value: s.id, label: s.name }))} />
  );
}

/** §7.4 fresh install: no system connected yet (uploaded files alone carry no document flow to mine). */
export function NoSystem() {
  return (
    <EmptyState
      title="Connect a system to discover processes"
      detail={`${NOT_MINABLE}. Connect a system, run discovery, then read the as-is flow.`}
      ghost="stepper"
      action={<Button render={<Link href="/systems">Connect a system</Link>} />}
    />
  );
}

export const l1Href = (l1: string, systemId: string, runId?: string, tab?: string) => {
  const p = new URLSearchParams({ system: systemId });
  if (runId) p.set("run", runId);
  if (tab) p.set("tab", tab);
  return `/process/${l1}?${p}`;
};

const discovered = (r: CatalogueRow) => r.coverage !== "reference" && !!r.last_run;

/** InsightHeader sentences for the catalogue and the process home (§7.3). */
export function processInsight(rows: CatalogueRow[], systemName: string, systemId: string,
                               canRun: boolean): InsightHeaderProps {
  const found = rows.filter(discovered);
  const finished = rows.map((r) => r.last_run?.finished_at).filter((t): t is string => !!t).sort();
  const scored = found.filter((r) => r.last_run?.fitness != null)
    .sort((a, b) => (a.last_run!.fitness as number) - (b.last_run!.fitness as number));
  const worst = scored[0];
  const top = [...found].sort((a, b) => (b.last_run?.cases ?? 0) - (a.last_run?.cases ?? 0))[0];
  return {
    situation: {
      sentence: `${found.length} of ${rows.length} processes discovered on ${systemName}; ${rows.length - found.length} reference only.`,
      tone: found.length ? "go" : "neutral",
    },
    changed: {
      sentence: finished.length ? `Last run finished ${relativeTime(finished[finished.length - 1])}.` : "No discovery run yet.",
    },
    why: worst
      ? { sentence: `${worst.name} fitness ${fmtFitness(worst.last_run?.fitness)} is the lowest.`,
          tone: fitnessTone(worst.last_run?.fitness), href: l1Href(worst.l1, systemId, worst.last_run?.id, "conformance") }
      : { sentence: "Conformance is measured once a process is discovered." },
    next: !canMine(rows)
      ? { sentence: `${NOT_MINABLE}.` }
      : canRun
      ? { sentence: found.length ? "Refresh the event log since the last run." : "Extract the event tables and mine every process.",
          action: { label: found.length ? "Run incremental discovery" : "Run discovery", href: `/process/runs?system=${systemId}&new=1` } }
      : top
        ? { sentence: `Read the most frequent ${top.name} paths.`,
            action: { label: `Open ${top.name} variants`, href: l1Href(top.l1, systemId, top.last_run?.id, "variants") } }
        : { sentence: ASK_TO_RUN_DISCOVERY },
  };
}

/** One figure of a catalogue card: a label over a value, in the stat grid. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="m-text-label m-ink-3">{label}</dt>
      <dd className="m-text-h font-semibold m-ink tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The catalogue as one Card per L1 (spec §7.3): name and L1 id, coverage, the fitness verdict, cases, variants,
 * median duration, DQ defects and the last run, each opening its view. Ranked lowest fitness first, so the process
 * furthest from its model leads; processes not discovered follow.
 */
export function CatalogueCards({ rows, systemId, jobs }: { rows: CatalogueRow[]; systemId: string; jobs: Job[] }) {
  const ranked = [...rows].sort((a, b) => (a.last_run?.fitness ?? 2) - (b.last_run?.fitness ?? 2));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Processes" data-tour="process-catalogue">
      {ranked.map((r) => <li key={r.l1} className="grid"><CatalogueCard row={r} systemId={systemId} jobs={jobs} /></li>)}
    </ul>
  );
}

function CatalogueCard({ row: r, systemId, jobs }: { row: CatalogueRow; systemId: string; jobs: Job[] }) {
  const runId = r.last_run && r.coverage !== "reference" ? r.last_run.id : undefined;
  const href = l1Href(r.l1, systemId, runId);
  const f = r.last_run?.fitness;
  const live = r.in_progress && (stageLabel(jobs.find((j) => j.id === r.in_progress?.job_id)) ?? <RunStatusPill status={r.in_progress.status} />);
  return (
    <Card padding="sm" title={<DrillLink href={href}>{r.name}</DrillLink>} meta={<Mono>{r.l1}</Mono>}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CoveragePill coverage={r.coverage} />
          {live && <span className="m-text-meta m-ink-3">{live}</span>}
          {r.failed && <DrillLink href={`/process/runs/${r.failed.id}`}>See the error</DrillLink>}
        </div>
        {r.reason && r.coverage === "reference" && <p className="m-text-meta m-ink-3">{r.reason}</p>}
        <dl className="m-stat-grid">
          <Figure label="Fitness">
            {f == null || !runId ? "—" : (
              <DrillLink href={l1Href(r.l1, systemId, runId, "conformance")}><Pill tone={fitnessTone(f)}>{fmtFitness(f)}</Pill></DrillLink>
            )}
          </Figure>
          <Figure label="Cases">{fmtCount(r.last_run?.cases)}</Figure>
          <Figure label="Variants">
            {runId && r.last_run?.variants != null
              ? <DrillLink href={l1Href(r.l1, systemId, runId, "variants")}>{fmtCount(r.last_run.variants)}</DrillLink>
              : fmtCount(r.last_run?.variants)}
          </Figure>
          <Figure label="Median duration">{fmtSeconds(r.last_run?.median_seconds)}</Figure>
          <Figure label="DQ defects"><DqDefects n={r.dq_defects} versionId={r.dq_version_id} l1={r.l1} /></Figure>
        </dl>
        <p className="m-text-meta m-ink-3">{r.last_run?.finished_at ? `Last run ${relativeTime(r.last_run.finished_at)}` : "Not run yet"}</p>
      </div>
    </Card>
  );
}

/** `names`: catalogue L1 id to process name; a run reads as its process, the id in Mono beside it. */
export function RunsTable({ runs, jobs, systemName, names, hideToolbar }: {
  runs: DiscoveryRun[]; jobs: Job[]; systemName: string; names?: ReadonlyMap<string, string>; hideToolbar?: boolean;
}) {
  const job = (r: DiscoveryRun) => jobs.find((j) => j.id === r.job_id);
  const nameOf = (l1: string) => names?.get(l1) ?? l1;
  const columns: ColumnDef<DiscoveryRun>[] = [
    { id: "system", header: "System", cell: () => systemName },
    { accessorKey: "l1", header: "Process", cell: ({ row }) => (
        <span className="flex items-baseline gap-2">
          <DrillLink href={`/process/runs/${row.original.id}`}>{nameOf(row.original.l1)}</DrillLink><Mono>{row.original.l1}</Mono>
        </span>) },
    { accessorKey: "mode", header: "Mode", cell: ({ row }) => (row.original.mode === "incremental" ? "Incremental" : "Full") },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <RunStatusPill status={row.original.status} /> },
    { id: "stage", header: "Stage", cell: ({ row }) => stageLabel(job(row.original)) ?? "—" },
    { id: "percent", header: "Percent", cell: ({ row }) => { const j = job(row.original); return j && ACTIVE_RUN.has(row.original.status) ? `${Math.round(j.percent)}%` : "—"; } },
    { accessorKey: "started_at", header: "Started", cell: ({ row }) => relativeTime(row.original.started_at) },
    { id: "duration", header: "Duration", cell: ({ row }) => (row.original.finished_at
        ? fmtSeconds((Date.parse(row.original.finished_at) - Date.parse(row.original.started_at)) / 1000) : "—") },
    { id: "cases", header: "Cases", cell: ({ row }) => fmtCount(row.original.stats?.cases) },
    { accessorKey: "coverage", header: "Coverage", cell: ({ row }) => (row.original.coverage ? <CoveragePill coverage={row.original.coverage} /> : "—") },
    { id: "open", header: "", size: 80, enableSorting: false, cell: ({ row }) => (
        <Link href={`/process/runs/${row.original.id}`} className="m-ink-accent-ink underline" aria-label={`Open run ${nameOf(row.original.l1)}`}>Open</Link>) },
  ];
  return <DataTable columns={columns} data={runs} getRowId={(r) => r.id} height="auto" hideToolbar={hideToolbar}
    tableId="process-runs" exportName="process-discovery-runs" />;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Headline figures over the discovered L1s. Case counts and automation are per-L1 only: they do not add across processes. */
export function headline(rows: CatalogueRow[]) {
  const runs = rows.filter((r) => r.coverage !== "reference" && r.last_run).map((r) => r.last_run!);
  return {
    discovered: runs.length,
    fitness: median(runs.map((r) => r.fitness).filter((f): f is number => f != null)),
  };
}

/** Spec 7.5: every chart has a DataTable alternative behind "View as table". */
export function ViewAsTable({ chart, table }: { chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <Button variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? "View as chart" : "View as table"}
        </Button>
      </div>
      {asTable ? table : chart}
    </div>
  );
}

export const fmtShare = (s: number | null | undefined) => (s == null ? "—" : `${Math.round(s * 1000) / 10}%`);
