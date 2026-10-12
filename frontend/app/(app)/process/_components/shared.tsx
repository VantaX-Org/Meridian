"use client";

/**
 * Pieces shared by the process home, the catalogue and the runs pages
 * (process-discovery spec §7.3): the `?system=` choice, the L1 card grid,
 * the runs table and the InsightHeader sentences.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Card, DataTable, DrillLink, EmptyState, Mono, Pill, Select, Skeleton, type InsightHeaderProps, type PillTone,
} from "@/design";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/connectivity";
import { ACTIVE_RUN, type CatalogueRow, type DiscoveryRun } from "@/lib/api/process-discovery";
import { formatDuration } from "@/lib/job-timing";
import { relativeTime } from "@/lib/format";
import { useSystemScope } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import type { Job } from "@/types/jobs";
import { CoveragePill, RunStatusPill } from "./coverage-pill";

export const fitnessTone = (f: number | null | undefined): PillTone =>
  f == null ? "neutral" : f >= 0.8 ? "go" : f >= 0.6 ? "at-risk" : "no-go";
export const fmtFitness = (f: number | null | undefined) => (f == null ? "—" : `${Math.round(f * 1000) / 10}%`);
export const fmtSeconds = (s: number | null | undefined) => (s == null ? "—" : formatDuration(s));
export const fmtCount = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

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

/** §7.4 fresh install: no system connected yet. */
export function NoSystem() {
  return (
    <EmptyState
      title="Connect a system to discover processes"
      detail="Connect a system, run discovery, then read the as-is flow."
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
      ? { sentence: `${worst.l1} fitness ${fmtFitness(worst.last_run?.fitness)} is the lowest.`,
          tone: fitnessTone(worst.last_run?.fitness), href: l1Href(worst.l1, systemId, worst.last_run?.id, "conformance") }
      : { sentence: "Conformance is measured once a process is discovered." },
    next: canRun
      ? { sentence: found.length ? "Refresh the event log since the last run." : "Extract the event tables and mine every process.",
          action: { label: found.length ? "Run incremental discovery" : "Run discovery", href: `/process/runs?system=${systemId}&new=1` } }
      : top
        ? { sentence: `Read the most frequent ${top.l1} paths.`,
            action: { label: `Open ${top.l1} variants`, href: l1Href(top.l1, systemId, top.last_run?.id, "variants") } }
        : { sentence: "Ask a process analyst to run discovery." },
  };
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] leading-[14px]" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="m-numeric text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{children}</span>
    </div>
  );
}

export function CatalogueGrid({ rows, systemId, jobs }: { rows: CatalogueRow[]; systemId: string; jobs: Job[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      {rows.map((r) => {
        const run = r.last_run;
        const active = r.in_progress;
        const failed = r.failed;
        const done = !!run && r.coverage !== "reference";
        return (
          <Card key={r.l1} title={r.name} meta={<Mono>{r.l1}</Mono>} padding="sm">
            <div className="grid gap-2">
              <div><CoveragePill coverage={r.coverage} /></div>
              {r.reason && <p className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{r.reason}</p>}
              {active && (
                <div className="grid gap-1">
                  <Skeleton height={16} />
                  <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
                    {stageLabel(jobs.find((j) => j.id === active.job_id)) ?? <RunStatusPill status={active.status} />}
                  </span>
                </div>
              )}
              {failed && !active && (
                <span className="flex items-center gap-2"><RunStatusPill status="failed" />
                  <DrillLink href={`/process/runs/${failed.id}`}>See the error</DrillLink></span>
              )}
              {done && (
                <div className="grid grid-cols-4 gap-2">
                  <Figure label="Cases"><DrillLink href={l1Href(r.l1, systemId, run.id, "cases")}>{fmtCount(run.cases)}</DrillLink></Figure>
                  <Figure label="Variants"><DrillLink href={l1Href(r.l1, systemId, run.id, "variants")}>{fmtCount(run.variants)}</DrillLink></Figure>
                  <Figure label="Fitness"><DrillLink href={l1Href(r.l1, systemId, run.id, "conformance")}>{fmtFitness(run.fitness)}</DrillLink></Figure>
                  <Figure label="Median">{fmtSeconds(run.median_seconds)}</Figure>
                </div>
              )}
              <div className="flex items-center justify-between text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
                <span>{run?.finished_at ? `Last run ${relativeTime(run.finished_at)}` : "Not run yet"}</span>
                <DrillLink href={l1Href(r.l1, systemId, done ? run.id : undefined)}>Open {r.l1}</DrillLink>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function CatalogueTable({ rows, systemId, jobs }: { rows: CatalogueRow[]; systemId: string; jobs: Job[] }) {
  const href = (r: CatalogueRow) => l1Href(r.l1, systemId, r.last_run && r.coverage !== "reference" ? r.last_run.id : undefined);
  const columns: ColumnDef<CatalogueRow>[] = [
    { accessorKey: "name", header: "Process", cell: ({ row: { original: r } }) => (
        <span className="flex items-baseline gap-2">
          <DrillLink href={href(r)}>{r.name}</DrillLink><Mono>{r.l1}</Mono>
        </span>
      ) },
    { id: "coverage", header: "Coverage", accessorFn: (r) => r.coverage, cell: ({ row: { original: r } }) => <CoveragePill coverage={r.coverage} /> },
    { id: "fitness", header: "Fitness", accessorFn: (r) => r.last_run?.fitness ?? -1, cell: ({ row: { original: r } }) => {
        const f = r.last_run?.fitness;
        const last = f == null ? "—" : (
          <DrillLink href={l1Href(r.l1, systemId, r.last_run!.id, "conformance")}>
            <Pill tone={fitnessTone(f)}>{fmtFitness(f)}</Pill>
          </DrillLink>
        );
        if (!r.failed && !r.in_progress) return last;
        const live = r.in_progress && (stageLabel(jobs.find((j) => j.id === r.in_progress?.job_id)) ?? <RunStatusPill status={r.in_progress.status} />);
        return (
          <span className="flex items-center gap-2">{last}
            {live && <span style={{ color: "var(--m-ink-3)" }}>{live}</span>}
            {r.failed && <DrillLink href={`/process/runs/${r.failed.id}`}>See the error</DrillLink>}
          </span>
        );
      } },
    { id: "variants", header: "Variants", accessorFn: (r) => r.last_run?.variants ?? -1, cell: ({ row: { original: r } }) => fmtCount(r.last_run?.variants) },
    { id: "cases", header: "Cases", accessorFn: (r) => r.last_run?.cases ?? -1, cell: ({ row: { original: r } }) => fmtCount(r.last_run?.cases) },
    { id: "median", header: "Median duration", accessorFn: (r) => r.last_run?.median_seconds ?? -1, cell: ({ row: { original: r } }) => fmtSeconds(r.last_run?.median_seconds) },
    { id: "finished", header: "Last run", accessorFn: (r) => r.last_run?.finished_at ?? "", cell: ({ row: { original: r } }) => (
        r.last_run?.finished_at ? relativeTime(r.last_run.finished_at) : "Not run yet") },
  ];
  const router = useRouter();
  return <DataTable columns={columns} data={rows} getRowId={(r) => r.l1} height="auto" hideToolbar
    onRowClick={(r) => router.push(href(r))} rowHref={href} tableId="process-catalogue" exportName="process-catalogue" />;
}

export function RunsTable({ runs, jobs, systemName, hideToolbar }: {
  runs: DiscoveryRun[]; jobs: Job[]; systemName: string; hideToolbar?: boolean;
}) {
  const job = (r: DiscoveryRun) => jobs.find((j) => j.id === r.job_id);
  const columns: ColumnDef<DiscoveryRun>[] = [
    { id: "system", header: "System", cell: () => systemName },
    { accessorKey: "l1", header: "L1", cell: ({ row }) => <DrillLink href={`/process/runs/${row.original.id}`}><Mono>{row.original.l1}</Mono></DrillLink> },
    { accessorKey: "mode", header: "Mode", cell: ({ row }) => (row.original.mode === "incremental" ? "Incremental" : "Full") },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <RunStatusPill status={row.original.status} /> },
    { id: "stage", header: "Stage", cell: ({ row }) => stageLabel(job(row.original)) ?? "—" },
    { id: "percent", header: "Percent", cell: ({ row }) => { const j = job(row.original); return j && ACTIVE_RUN.has(row.original.status) ? `${Math.round(j.percent)}%` : "—"; } },
    { accessorKey: "started_at", header: "Started", cell: ({ row }) => relativeTime(row.original.started_at) },
    { id: "duration", header: "Duration", cell: ({ row }) => (row.original.finished_at
        ? fmtSeconds((Date.parse(row.original.finished_at) - Date.parse(row.original.started_at)) / 1000) : "—") },
    { id: "cases", header: "Cases", cell: ({ row }) => fmtCount(row.original.stats?.cases) },
    { accessorKey: "coverage", header: "Coverage", cell: ({ row }) => (row.original.coverage ? <CoveragePill coverage={row.original.coverage} /> : "—") },
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
