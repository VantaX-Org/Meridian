"use client";

/**
 * Connect and load > one run. Tabs in the URL (?tab=): Summary, Profile, Tables, Log.
 * A run is one version: what was read, how it scored, and what its fields look like.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, DataTable, Select, Tabs, type AuroraColumnMeta } from "@/components/aurora";
import { EmptyState, KeyValue, Mono, PageHeader, SectionCard, TableSkeleton, Tally, type Status } from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { StageStepper, fmtDuration, fmtInt } from "@/components/data/job-card";
import { FieldProfileTable, HiddenRules } from "@/components/data/field-profile-table";
import { getVersionProfile } from "@/lib/api/field-profile";
import { analyseVersion, getSystemVersions, type SystemVersion } from "@/lib/api/system-objects";
import { getSystems } from "@/lib/api/connectivity";
import { compareVersions, getVersion } from "@/lib/api/versions";
import { formatModuleName, relativeTime, formatDate, labelOf } from "@/lib/format";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import type { Job } from "@/types/jobs";

type Tab = "summary" | "profile" | "tables" | "log";
const TABS: readonly Tab[] = ["summary", "profile", "tables", "log"];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

const meta = (m: AuroraColumnMeta) => m;
const RUN_STATUS: Record<string, Status> = { complete: "ok", agents_complete: "ok", ai_enriched: "ok", failed: "failed", agents_failed: "failed", running: "running", pending: "running", agents_running: "running", ai_enriching: "running", agents_enqueued: "running" };
const RUN_LABEL: Record<string, string> = { complete: "Complete", agents_complete: "Complete", ai_enriched: "Complete", failed: "Failed", agents_failed: "Failed", running: "Running", pending: "Queued", agents_running: "Running", ai_enriching: "Running", agents_enqueued: "Queued" };
const meanDqs = (d: Record<string, number | null> | undefined) => {
  const x = Object.values(d ?? {}).filter((v): v is number => typeof v === "number");
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};
const clock = (sec: number | null | undefined) => (sec ? formatDate(sec * 1000, "datetime") : "Not recorded");

interface ObjectRow { object: string; records: number; dqs: number | null }
interface TableRow { table: string; status: string; rows: number | null; expected: number | null; detail: string }

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useRole();
  const [tabParam, setTab] = useUrlState("tab", "summary");
  const tab: Tab = isTab(tabParam) ? tabParam : "summary";
  const [objectParam, setObject] = useUrlState("object", "");
  const { jobs, active } = useJobs();
  const nowSec = useNowSec(active.length > 0);

  const versionQ = useQuery({ queryKey: ["version", id], queryFn: () => getVersion(id) });
  const systemId = versionQ.data?.metadata?.system_id ?? "";
  const systemsQ = useQuery({ queryKey: ["systems"], queryFn: getSystems, enabled: !!systemId });
  const siblingsQ = useQuery({ queryKey: ["system-versions", systemId], queryFn: () => getSystemVersions(systemId), enabled: !!systemId });
  const runs = useMemo(() => [...(siblingsQ.data?.versions ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at)), [siblingsQ.data]);
  const row: SystemVersion | undefined = runs.find((v) => v.id === id);
  const previous = runs.find((v) => v.run_at < (row?.run_at ?? "") && v.analysable);
  const job: Job | undefined = jobs.find((j) => j.version_id === id);

  const profileQ = useQuery({
    queryKey: ["version-profile", systemId, id, objectParam],
    queryFn: () => getVersionProfile(systemId, id, objectParam || undefined),
    enabled: !!systemId && tab === "profile",
  });
  const diffQ = useQuery({
    queryKey: ["versions.compare", previous?.id, id],
    queryFn: () => compareVersions(previous!.id, id),
    enabled: !!previous && tab === "summary" && !!row?.analysed_at,
  });

  const analyse = useMutation({
    mutationFn: () => analyseVersion(id),
    onSuccess: () => { toast.success("Analysis started"); for (const k of ["version", "system-versions", "version-profile"]) void qc.invalidateQueries({ queryKey: [k] }); },
    onError: (e: unknown) => toast.error((e as Error).message || "Analysis refused"),
  });

  const version = versionQ.data;
  const systemName = systemsQ.data?.find((s) => s.id === systemId)?.name;
  const title = version ? (version.label || version.metadata?.file_name || `Run of ${formatDate(version.run_at)}`) : "Run";
  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "hub", label: "Connect & load", href: "/data" },
      { level: "page", label: title },
    ]} />
  );

  const objectRows = useMemo<ObjectRow[]>(() => {
    const records = row?.records ?? version?.metadata?.object_rows ?? {};
    const names = Array.from(new Set([...(row?.objects ?? []), ...Object.keys(records)]));
    return names.map((o) => ({ object: o, records: records[o] ?? 0, dqs: row?.dqs?.[o] ?? version?.dqs_summary?.[o]?.composite_score ?? null }));
  }, [row, version]);

  const tableRows = useMemo<TableRow[]>(() => {
    if (job?.tables?.length) return job.tables.map((t) => ({ table: t.table, status: t.status, rows: t.rows, expected: t.expected, detail: "" }));
    return (row?.coverage.issues ?? []).map((i) => ({ table: i.table, status: i.status, rows: i.rows, expected: i.source_rows, detail: i.detail ?? "" }));
  }, [job, row]);

  const objectCols = useMemo<ColumnDef<ObjectRow, unknown>[]>(() => [
    { id: "object", header: "Object", meta: meta({ minWidth: 220 }), cell: ({ row: r }) => formatModuleName(r.original.object) },
    { id: "records", header: "Records", meta: meta({ width: 130, numeric: true, align: "end" }), cell: ({ row: r }) => fmtInt(r.original.records) },
    { id: "dqs", header: "Score", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row: r }) => (r.original.dqs === null ? "Not analysed" : r.original.dqs.toFixed(1)) },
  ], []);
  const tableCols = useMemo<ColumnDef<TableRow, unknown>[]>(() => [
    { id: "table", header: "Table", meta: meta({ minWidth: 180 }), cell: ({ row: r }) => <Mono>{r.original.table}</Mono> },
    { id: "status", header: "Status", meta: meta({ width: 150 }), cell: ({ row: r }) => r.original.status.replace(/_/g, " ") },
    { id: "rows", header: "Records read", meta: meta({ width: 140, numeric: true, align: "end" }), cell: ({ row: r }) => (r.original.rows === null ? "" : fmtInt(r.original.rows)) },
    { id: "expected", header: "In the system", meta: meta({ width: 140, numeric: true, align: "end" }), cell: ({ row: r }) => (r.original.expected === null ? "Not known" : fmtInt(r.original.expected)) },
    { id: "detail", header: "Note", meta: meta({ minWidth: 220 }), cell: ({ row: r }) => r.original.detail },
  ], []);

  if (versionQ.isLoading) return <div className="ui-page">{crumb}<TableSkeleton rows={6} label="Loading the run" /></div>;
  if (versionQ.error || !version) {
    return (
      <div className="ui-page">{crumb}
        <Banner tone="danger" title={versionQ.error ? "The run could not be read" : "No such run"}
          action={<Button size="sm" variant="secondary" onClick={() => versionQ.refetch()}>Retry</Button>}>
          {versionQ.error ? (versionQ.error as Error).message : <>It may have been removed. <Link href="/data?tab=runs" className="ui-link">Open all runs</Link></>}
        </Banner>
      </div>
    );
  }

  const here = `/data/runs/${id}`;
  const status = job?.status === "running" ? "running" : version.status;
  const total = objectRows.reduce((a, o) => a + o.records, 0);
  const rowsRead = job && job.rows_done > 0 ? job.rows_done : total;
  const dqs = meanDqs(row?.dqs) ?? meanDqs(Object.fromEntries(Object.entries(version.dqs_summary ?? {}).map(([k, s]) => [k, s.composite_score])));
  const capped = Object.values(version.dqs_summary ?? {}).find((s) => s.capped);
  const duration = job ? fmtDuration(Math.max(0, (job.finished_at ?? nowSec) - job.started_at)) : "Not recorded";
  const profileObjects = Array.from(new Set([...(profileQ.data?.objects ?? []), ...(objectParam ? [objectParam] : [])]));
  const compareHref = previous ? `/analyse?${new URLSearchParams({ tab: "analyses", compare: `${previous.id},${id}` })}` : null;

  return (
    <div className="ui-page">
      {crumb}
      <PageHeader title={title}
        summary={`${systemName ? `${systemName}. ` : ""}Run ${relativeTime(version.run_at)}${version.metadata?.source === "upload" ? ", imported from a file" : ""}.`}
        actions={<>
          {compareHref ? <Link href={compareHref} className="aurora-btn" data-variant="secondary">Compare with previous</Link> : null}
          {can("analyse") && systemId ? <Button variant="secondary" onClick={() => analyse.mutate()} disabled={analyse.isPending || row?.analysable === false}>Analyse</Button> : null}
        </>} />

      <Tally level={2} label="This run at a glance" figures={[
        { label: "Status", value: null, text: RUN_LABEL[status] ?? status, href: `${here}?tab=log`, tone: RUN_STATUS[status] === "failed" ? "danger" : RUN_STATUS[status] === "ok" ? "success" : undefined,
          verdict: job?.error ?? (version.metadata?.file_name || "See the log.") },
        { label: "Records read", value: rowsRead, href: `${here}?tab=tables`, verdict: job && job.rows_total > 0 && job.status === "running" ? `${fmtInt(job.rows_done)} of ${fmtInt(job.rows_total)} so far.` : `Across ${objectRows.length} objects.` },
        { label: "Tables", value: tableRows.length || (row ? row.coverage.read : 0), href: `${here}?tab=tables`, verdict: row ? `${row.coverage.read} read, ${row.coverage.issues.length} with a note.` : "Per table detail needs a system run." },
        { label: "Duration", value: null, text: job ? duration : undefined, href: `${here}?tab=log`, verdict: job ? `Started ${clock(job.started_at)}.` : "Timing is kept while the job is on the server." },
        { label: "Score", value: dqs === null ? null : Math.round(dqs), href: `${here}?tab=summary`, unit: dqs === null ? undefined : "of 100",
          tone: capped ? "warning" : undefined, verdict: capped?.cap_reason ?? (dqs === null ? "Run Analyse to score it." : "Mean across objects.") },
      ]} />

      <Tabs<Tab> ariaLabel="Run" value={tab} onValueChange={setTab}
        items={[{ id: "summary", label: "Summary" }, { id: "profile", label: "Profile" }, { id: "tables", label: "Tables", count: tableRows.length || undefined }, { id: "log", label: "Log" }]} />

      {tab === "summary" ? (
        <div className="ui-stack">
          <SectionCard title="Objects" flush meta={objectRows.length || undefined}>
            <DataTable<ObjectRow> ariaLabel="Objects in this run" columns={objectCols} data={objectRows} getRowId={(o) => o.object} maxHeight={360}
              empty={<EmptyState>No object was read in this run.</EmptyState>} />
          </SectionCard>
          <SectionCard title="Newly failing since the previous run">
            {!previous ? <EmptyState>There is no earlier analysed run to compare with.</EmptyState>
              : !row?.analysed_at ? <EmptyState>Analyse this run to see what changed.</EmptyState>
              : diffQ.isLoading ? <TableSkeleton rows={3} label="Comparing" />
              : diffQ.error ? <Banner tone="danger" title="The comparison could not be read" />
              : diffQ.data?.checks.newly_failing.length ? (
                <table className="ui-mini-table">
                  <thead><tr><th>Check</th><th>Object</th><th>Severity</th><th>Affected before</th><th>Affected now</th></tr></thead>
                  <tbody>{diffQ.data.checks.newly_failing.slice(0, 20).map((c) => (
                    <tr key={`${c.module}${c.check_id}`}><td><Mono>{c.check_id}</Mono></td><td>{formatModuleName(c.module)}</td><td>{labelOf(c.severity)}</td><td>{fmtInt(c.v1_affected)}</td><td>{fmtInt(c.v2_affected)}</td></tr>
                  ))}</tbody>
                </table>
              ) : <EmptyState>No check started failing.</EmptyState>}
          </SectionCard>
          <SectionCard title="Settings used">
            <KeyValue rows={[
              { k: "Rule set", v: row?.rule_set ?? "Not recorded" },
              { k: "Modules", v: (version.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Not recorded" },
              { k: "Baseline", v: (row?.baseline ?? version.metadata?.baseline) ? "This run is the baseline" : "Not the baseline" },
              { k: "Scope", v: row?.scope ? JSON.stringify(row.scope) : "Not recorded" },
            ]} />
          </SectionCard>
        </div>
      ) : null}

      {tab === "profile" ? (
        !systemId ? <EmptyState>No profile for this run. Profiles are built during extraction.</EmptyState>
        : profileQ.isLoading ? <TableSkeleton rows={6} label="Reading the profile" />
        : profileQ.error ? <Banner tone="danger" title="The profile could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => profileQ.refetch()}>Retry</Button>} />
        : profileQ.data ? (
          <div className="ui-stack">
            {profileObjects.length ? (
              <Select aria-label="Object" options={profileObjects.map((o) => ({ value: o, label: formatModuleName(o) }))}
                value={profileQ.data.object ?? undefined} onValueChange={setObject} />
            ) : null}
            <FieldProfileTable profile={profileQ.data} object={profileQ.data.object ?? undefined} />
            {profileQ.data.tables.length ? <HiddenRules deps={profileQ.data.dependencies} module={profileQ.data.object} /> : null}
          </div>
        ) : null
      ) : null}

      {tab === "tables" ? (
        <SectionCard title="Tables read" flush meta={tableRows.length || undefined}>
          <DataTable<TableRow> ariaLabel="Tables read by this run" columns={tableCols} data={tableRows} getRowId={(t) => t.table} maxHeight="65vh"
            empty={<EmptyState>No per table detail is kept for this run.</EmptyState>} />
        </SectionCard>
      ) : null}

      {tab === "log" ? (
        <SectionCard title="Log">
          {job ? (
            <div className="ui-stack">
              <StageStepper stages={job.stages} />
              <KeyValue rows={[
                { k: "Started", v: clock(job.started_at) },
                { k: "Last update", v: clock(job.updated_at) },
                { k: "Finished", v: job.finished_at ? clock(job.finished_at) : "Not finished" },
                { k: "Message", v: job.message || "None" },
                ...(job.error ? [{ k: "Error", v: job.error }] : []),
              ]} />
            </div>
          ) : (
            <KeyValue rows={[
              { k: "Run at", v: formatDate(version.run_at, "datetime") },
              { k: "Analysed", v: row?.analysed_at ? formatDate(row.analysed_at, "datetime") : "Not analysed" },
              { k: "Status", v: version.status },
            ]} />
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}
