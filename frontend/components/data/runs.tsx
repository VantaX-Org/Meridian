"use client";

/**
 * Data → Runs: everything that is running or has run — downloads, config
 * syncs, imports, analyses — live from the job stream, plus the durable
 * download history each system keeps as versions (jobs expire after a week;
 * versions do not).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Chip, DataTable, Drawer, EmptyState, KpiRail, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta,
} from "@/components/aurora";
import { getSystems } from "@/lib/api/systems";
import { getSystemVersions, type SystemVersion } from "@/lib/api/system-objects";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Job } from "@/types/jobs";
import { JobCard, KIND_LABEL, STATUS_TONE, fmtDuration, fmtInt, jobTiming } from "./job-card";

const DAY = 24 * 3600;
const meta = (m: AuroraColumnMeta) => m;

type VersionRow = SystemVersion & { systemId: string; systemName: string };

export function RunsSurface() {
  const { jobs, active, isLoading } = useJobs();
  const nowSec = useNowSec(active.length > 0);
  const drawer = useDrawerParam("job");

  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const systemName = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const versionQs = useQueries({
    queries: systems.map((s) => ({ queryKey: ["systems.versions", s.id], queryFn: () => getSystemVersions(s.id) })),
  });
  const versions = useMemo<VersionRow[]>(
    () => systems.flatMap((s, i) => (versionQs[i]?.data ?? []).map((v) => ({ ...v, systemId: s.id, systemName: s.name })))
      .sort((a, b) => b.run_at.localeCompare(a.run_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [systems, ...versionQs.map((q) => q.data)],
  );

  const since = nowSec - DAY;
  const last24 = jobs.filter((j) => j.updated_at >= since);
  const completed24 = last24.filter((j) => j.status === "completed").length;
  const failed24 = last24.filter((j) => j.status === "failed").length;
  const rows24 = last24.reduce((a, j) => a + (j.rows_done || 0), 0);
  const recent = jobs.filter((j) => j.status === "completed" || j.status === "failed");
  const selected = drawer.value ? jobs.find((j) => j.id === drawer.value) ?? null : null;

  const jobColumns = useMemo<ColumnDef<Job, unknown>[]>(() => [
    { id: "when", header: "Finished", meta: meta({ width: 110 }),
      cell: ({ row }) => <span title={new Date((row.original.finished_at ?? row.original.updated_at) * 1000).toLocaleString()}>
        {relativeTime(new Date((row.original.finished_at ?? row.original.updated_at) * 1000).toISOString())}</span> },
    { id: "kind", header: "Kind", meta: meta({ width: 110 }), cell: ({ row }) => KIND_LABEL[row.original.kind] },
    { id: "label", header: "Run", accessorKey: "label", meta: meta({ width: 260 }) },
    { id: "system", header: "System", meta: meta({ width: 140 }),
      cell: ({ row }) => (row.original.system_id && systemName.get(row.original.system_id)) || "—" },
    { id: "status", header: "Status", meta: meta({ width: 110 }),
      cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{row.original.status}</Chip> },
    { id: "duration", header: "Duration", meta: meta({ width: 100, numeric: true, align: "end" }),
      cell: ({ row }) => fmtDuration(jobTiming(row.original, nowSec).elapsed) },
    { id: "rows", header: "Rows", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => (row.original.rows_done ? fmtInt(row.original.rows_done) : "—") },
    { id: "note", header: "Note", cell: ({ row }) => row.original.error ?? row.original.message },
  ], [systemName, nowSec]);

  const versionColumns = useMemo<ColumnDef<VersionRow, unknown>[]>(() => [
    { id: "when", header: "Downloaded", meta: meta({ width: 110 }),
      cell: ({ row }) => <span title={new Date(row.original.run_at).toLocaleString()}>{relativeTime(row.original.run_at)}</span> },
    { id: "system", header: "System", accessorKey: "systemName", meta: meta({ width: 140 }) },
    { id: "label", header: "Version", meta: meta({ width: 220 }),
      cell: ({ row }) => <Link href={`/systems/${row.original.systemId}`} className="aurora-link">
        {row.original.label ?? row.original.objects.map(formatModuleName).join(", ")}</Link> },
    { id: "objects", header: "Objects", cell: ({ row }) => row.original.objects.map(formatModuleName).join(", ") },
    { id: "records", header: "Records", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => fmtInt(Object.values(row.original.records).reduce((a, b) => a + b, 0)) },
    { id: "coverage", header: "Read", meta: meta({ width: 130 }),
      cell: ({ row }) => {
        const n = row.original.coverage.issues.length;
        return n ? <Chip tone="warning">{n} table{n > 1 ? "s" : ""} incomplete</Chip>
          : row.original.extraction_complete === false ? <Chip tone="warning">incomplete</Chip> : <Chip tone="success">complete</Chip>;
      } },
    { id: "status", header: "Analysis", meta: meta({ width: 120 }),
      cell: ({ row }) => <Chip tone={row.original.status === "failed" ? "danger" : row.original.status.includes("complete") ? "success" : "info"}>
        {row.original.status.replace(/_/g, " ")}</Chip> },
    { id: "dqs", header: "DQS", meta: meta({ width: 90, numeric: true, align: "end" }),
      cell: ({ row }) => {
        const v = Object.values(row.original.dqs).filter((x): x is number => typeof x === "number");
        return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "—";
      } },
  ], []);

  return (
    <Stack gap={6} className="aurora-runs">
      <KpiRail>
        <Stat label="Running now" value={active.length} tone={active.length ? "info" : "neutral"} />
        <Stat label="Completed · 24h" value={completed24} tone="success" />
        <Stat label="Failed · 24h" value={failed24} tone={failed24 ? "danger" : "neutral"} />
        <Stat label="Rows read · 24h" value={fmtInt(rows24)} />
        <Stat label="Systems" value={systems.length} />
      </KpiRail>

      <section aria-labelledby="runs-live">
        <Text as="h2" id="runs-live" variant="text-lead" className="aurora-runs__h">In flight</Text>
        {active.length === 0 ? (
          <EmptyState title="Nothing is running." body="Downloads, imports and analyses appear here the moment they start, with a bar per SAP table." />
        ) : (
          <div className="aurora-runs__live">
            {active.map((j) => (
              <JobCard key={j.id} job={j} nowSec={nowSec} expanded
                       systemName={j.system_id ? systemName.get(j.system_id) : undefined} onOpen={() => drawer.open(j.id)} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="runs-recent">
        <Text as="h2" id="runs-recent" variant="text-lead" className="aurora-runs__h">Recent runs</Text>
        <DataTable<Job>
          ariaLabel="Recent runs"
          columns={jobColumns}
          data={recent}
          getRowId={(j) => j.id}
          onRowActivate={(j) => drawer.open(j.id)}
          maxHeight={420}
          empty={isLoading ? "Loading…" : "No runs in the last seven days."}
        />
      </section>

      <section aria-labelledby="runs-versions">
        <Text as="h2" id="runs-versions" variant="text-lead" className="aurora-runs__h">Download history</Text>
        <Text variant="text-small" tone="muted" className="aurora-runs__sub">
          Every download is a version. Open the system to analyse, compare or set a baseline.
        </Text>
        <DataTable<VersionRow>
          ariaLabel="Download history"
          columns={versionColumns}
          data={versions}
          getRowId={(v) => v.id}
          maxHeight={520}
          empty={systemsQ.isLoading ? "Loading…" : "No downloads yet. Connect a system under Systems and download its objects."}
        />
      </section>

      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Run details"
              header={selected ? <Text variant="text-lead">{KIND_LABEL[selected.kind]} · {selected.label}</Text> : null}>
        {selected ? (
          <Stack gap={4}>
            <JobCard job={selected} nowSec={nowSec} expanded
                     systemName={selected.system_id ? systemName.get(selected.system_id) : undefined} />
            {selected.version_id ? (
              <Text variant="text-small">
                Version{" "}
                <Link className="aurora-link" href={selected.system_id ? `/systems/${selected.system_id}` : "/versions"}>
                  {selected.version_id.slice(0, 8)}
                </Link>
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}
