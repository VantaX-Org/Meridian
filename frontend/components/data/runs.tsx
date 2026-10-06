"use client";

/**
 * Runs: everything that is running or has run (downloads, config
 * syncs, imports, analyses) live from the job stream, plus the durable
 * download history each system keeps as versions (jobs expire after a week;
 * versions do not).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable, DetailDrawer, EmptyState, Mono, PageHeader, SectionCard, StatusBadge, Tally, useDrawerParam,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { getSystems } from "@/lib/api/systems";
import { getSystemVersions, type SystemVersion } from "@/lib/api/system-objects";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { formatModuleName, relativeTime, formatDate, errorLabel, humanizeIds } from "@/lib/format";
import type { Job } from "@/types/jobs";
import { JobCard, KIND_LABEL, fmtDuration, fmtInt, jobTiming } from "./job-card";

const DAY = 24 * 3600;
const meta = (m: AuroraColumnMeta) => m;
const JOB_STATUS: Record<Job["status"], { badge: Status; label: string }> = {
  queued: { badge: "idle", label: "Queued" },
  running: { badge: "running", label: "Running" },
  completed: { badge: "ok", label: "Completed" },
  failed: { badge: "failed", label: "Failed" },
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type VersionRow = SystemVersion & { systemId: string; systemName: string };

export function RunsSurface() {
  const { jobs, active, isLoading } = useJobs();
  const nowSec = useNowSec(active.length > 0);
  const drawer = useDrawerParam("job");

  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const systemName = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const versionQs = useQueries({
    queries: systems.map((s) => ({ queryKey: ["systems.versions", s.id], queryFn: () => getSystemVersions(s.id).then((d) => d.versions) })),
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
    { id: "when", header: "Finished", meta: meta({ width: 120 }),
      cell: ({ row }) => {
        const d = new Date((row.original.finished_at ?? row.original.updated_at) * 1000);
        return <span title={formatDate(d, "datetime")}>{relativeTime(d.toISOString())}</span>;
      } },
    { id: "kind", header: "Kind", meta: meta({ width: 120 }), cell: ({ row }) => KIND_LABEL[row.original.kind] },
    { id: "label", header: "Run", meta: meta({ width: 260 }), cell: ({ row }) => humanizeIds(row.original.label) },
    { id: "system", header: "System", meta: meta({ width: 150 }),
      cell: ({ row }) => (row.original.system_id && systemName.get(row.original.system_id)) || "" },
    { id: "status", header: "Status", meta: meta({ width: 130 }),
      cell: ({ row }) => <StatusBadge status={JOB_STATUS[row.original.status].badge}>{JOB_STATUS[row.original.status].label}</StatusBadge> },
    { id: "duration", header: "Duration", meta: meta({ width: 100, numeric: true, align: "end" }),
      cell: ({ row }) => (row.original.status === "failed" ? "—" : fmtDuration(jobTiming(row.original, nowSec).elapsed)) },
    { id: "rows", header: "Rows", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => (row.original.rows_done ? fmtInt(row.original.rows_done) : "") },
    { id: "note", header: "Note", meta: meta({ minWidth: 240 }), cell: ({ row }) => (row.original.error ? errorLabel(row.original.error) : row.original.message) },
  ], [systemName, nowSec]);

  const versionColumns = useMemo<ColumnDef<VersionRow, unknown>[]>(() => [
    { id: "when", header: "Downloaded", meta: meta({ width: 120 }),
      cell: ({ row }) => <span title={formatDate(row.original.run_at, "datetime")}>{relativeTime(row.original.run_at)}</span> },
    { id: "system", header: "System", accessorKey: "systemName", meta: meta({ width: 150 }) },
    { id: "label", header: "Version", meta: meta({ width: 240 }),
      cell: ({ row }) => <Link href={`/data/runs/${row.original.id}`} className="ui-link">
        {row.original.label ?? row.original.objects.map(formatModuleName).join(", ")}</Link> },
    { id: "objects", header: "Objects", meta: meta({ minWidth: 200 }), cell: ({ row }) => row.original.objects.map(formatModuleName).join(", ") },
    { id: "records", header: "Records", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => fmtInt(Object.values(row.original.records).reduce((a, b) => a + b, 0)) },
    { id: "coverage", header: "Read", meta: meta({ width: 170 }),
      cell: ({ row }) => {
        const n = row.original.coverage.issues.length;
        return n ? <StatusBadge status="medium">{n} table{n > 1 ? "s" : ""} incomplete</StatusBadge>
          : row.original.extraction_complete === false ? <StatusBadge status="medium">Incomplete</StatusBadge>
          : <StatusBadge status="ok">Complete</StatusBadge>;
      } },
    { id: "status", header: "Analysis", meta: meta({ width: 140 }),
      cell: ({ row }) => {
        const s = row.original.status;
        return <StatusBadge status={s === "failed" ? "failed" : s.includes("complete") ? "ok" : "running"}>{cap(s.replace(/_/g, " "))}</StatusBadge>;
      } },
    { id: "dqs", header: "DQS", meta: meta({ width: 90, numeric: true, align: "end" }),
      cell: ({ row }) => {
        const v = Object.values(row.original.dqs).filter((x): x is number => typeof x === "number");
        return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "";
      } },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader
        title="Jobs"
        summary="Every download, config sync, import and analysis. Jobs are kept for seven days; the download history is kept for good."
      />
      <Tally level={2} label="Runs in the last 24 hours" figures={[
        { label: "Running now", value: active.length, href: "/data?tab=runs", verdict: active.length ? "Progress is shown for each stage." : "Nothing is running." },
        { label: "Finished today", value: completed24, href: "/data?tab=runs", verdict: "Completed in the last 24 hours." },
        { label: "Failed today", value: failed24, href: "/data?tab=runs", tone: failed24 ? "danger" : undefined, verdict: failed24 ? "Open a run to see why." : "No run failed." },
        { label: "Rows read today", value: rows24, href: "/data?tab=runs", verdict: "Across all runs in the last 24 hours." },
      ]} />

      <SectionCard title="Running now" meta={active.length || undefined}>
        {active.length === 0 ? (
          <EmptyState>Nothing is running. Downloads, imports and analyses appear here as soon as they start, with progress for each SAP table.</EmptyState>
        ) : (
          <div className="aurora-runs__live">
            {active.map((j) => (
              <JobCard key={j.id} job={j} nowSec={nowSec} expanded
                       systemName={j.system_id ? systemName.get(j.system_id) : undefined} onOpen={() => drawer.open(j.id)} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent runs" meta={recent.length || undefined} flush>
        <DataTable<Job>
          ariaLabel="Recent runs"
          columns={jobColumns}
          data={recent}
          getRowId={(j) => j.id}
          onRowActivate={(j) => drawer.open(j.id)}
          maxHeight={420}
          empty={isLoading ? "Loading runs" : "No runs in the last seven days."}
        />
      </SectionCard>

      <SectionCard title="Download history" meta={versions.length || undefined} flush>
        <DataTable<VersionRow>
          ariaLabel="Download history. Each download is a version; open a version to see its profile and tables."
          columns={versionColumns}
          data={versions}
          getRowId={(v) => v.id}
          maxHeight={520}
          empty={systemsQ.isLoading ? "Loading downloads" : "No downloads yet. Connect a system under Systems and download its objects."}
        />
      </SectionCard>

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Run details"
              header={selected ? (
                <div className="ui-drawer-head">
                  <StatusBadge status={JOB_STATUS[selected.status].badge}>{KIND_LABEL[selected.kind]}</StatusBadge>
                  <h2 className="ui-drawer-head__title">{selected.label}</h2>
                </div>
              ) : null}>
        {selected ? (
          <div className="ui-detail">
            <JobCard job={selected} nowSec={nowSec} expanded
                     systemName={selected.system_id ? systemName.get(selected.system_id) : undefined} />
            {selected.version_id ? (
              <p className="ui-note">
                Produced run{" "}
                <Link className="ui-link" href={`/data/runs/${selected.version_id}`}>
                  <Mono>{selected.version_id.slice(0, 8)}</Mono>
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
