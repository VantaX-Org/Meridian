"use client";

/**
 * Live operations: what is running now and what needs a decision. Every
 * figure is read from the API. Job progress comes from the job stream and is
 * shown only where the job reports rows.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, DataTable, EmptyState, Mono, SectionCard, StatusBadge, TableSkeleton, Tally, Verdict,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { JobCard } from "@/components/data/job-card";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { getFindings } from "@/lib/api/findings";
import { getSystems } from "@/lib/api/connectivity";
import { getMetrics, getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const findingsHref = (p: Record<string, string>) => `/analyse?${new URLSearchParams({ tab: "findings", ...p })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const typeLabel = (t: string) => { const s = t.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

const HEALTH: Record<string, { status: Status; label: string }> = {
  healthy: { status: "ok", label: "Healthy" },
  degraded: { status: "medium", label: "Degraded" },
  unreachable: { status: "failed", label: "Unreachable" },
  auth_failed: { status: "failed", label: "Sign-in failed" },
  unknown: { status: "idle", label: "Not checked" },
};

interface ResolutionRow { type: string; open: number; hours: number | null }

export function LiveOperationsPage() {
  const { active } = useJobs();
  const nowSec = useNowSec(true, 5_000);

  const critQ = useQuery({ queryKey: ["findings.list", { severity: "critical", limit: 50 }], queryFn: () => getFindings({ severity: "critical", limit: 50 }) });
  const highQ = useQuery({ queryKey: ["findings.list", { severity: "high", limit: 50 }], queryFn: () => getFindings({ severity: "high", limit: 50 }) });
  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  // 200 is the stewardship API's own page cap.
  const stewardQ = useQuery({ queryKey: ["stewardship.queue", { status: "open", limit: 200 }], queryFn: () => getQueueItems({ status: "open", limit: 200 }) });
  const metricsQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, retry: false, meta: { ignoreError: true } });

  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const systemName = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);

  const loading = critQ.isLoading || highQ.isLoading || systemsQ.isLoading || stewardQ.isLoading;
  const error = critQ.error || highQ.error || systemsQ.error || stewardQ.error;

  const critTotal = critQ.data?.total ?? 0;
  const highTotal = highQ.data?.total ?? 0;
  const inbox = [...(critQ.data?.findings ?? []), ...(highQ.data?.findings ?? [])].slice(0, 8);
  const queue = stewardQ.data?.items ?? [];
  const queueTotal = stewardQ.data?.total ?? queue.length;
  // Counted over the fetched page, not a server total.
  const breached = queue.filter((t) => t.sla_state === "breached").length;
  const healthy = systems.filter((s) => s.health_status === "healthy").length;

  const resolution = useMemo<ResolutionRow[]>(() => {
    const m = metricsQ.data;
    if (!m) return [];
    return Object.keys(m.items_by_type)
      .map((type) => ({ type, open: m.items_by_type[type] ?? 0, hours: m.avg_resolution_hours_by_type[type] ?? null }))
      .sort((a, b) => b.open - a.open);
  }, [metricsQ.data]);

  const resolutionColumns = useMemo<ColumnDef<ResolutionRow, unknown>[]>(() => [
    { id: "type", header: "Type", meta: meta({ minWidth: 220 }),
      cell: ({ row }) => <Link href="/workbench" className="ui-link">{typeLabel(row.original.type)}</Link> },
    { id: "items", header: "Items", meta: meta({ width: 120, numeric: true, align: "end" }), cell: ({ row }) => row.original.open.toLocaleString() },
    { id: "hours", header: "Average to resolve", meta: meta({ width: 180, numeric: true, align: "end" }),
      cell: ({ row }) => (row.original.hours === null ? "" : `${row.original.hours.toFixed(1)} hours`) },
  ], []);

  const verdict = loading || error ? null
    : `${plural(active.length, "job")} running, ${plural(breached, "queue item")} past SLA, ${healthy} of ${plural(systems.length, "system")} healthy.`;

  return (
    <div className="ui-page">
      {verdict ? <Verdict>{verdict}</Verdict> : null}

      {loading ? <TableSkeleton rows={8} label="Loading live operations" />
        : error ? <Banner tone="danger" title="Live operations could not be read">{(error as Error).message}</Banner>
        : (
          <>
            <Tally level={2} label="Live figures" figures={[
              { label: "Jobs running", value: active.length, href: "/data?tab=runs", verdict: active.length ? "Progress is shown for each job." : "Nothing is running." },
              { label: "Queue items open", value: queueTotal, href: "/workbench", verdict: "Waiting for a steward." },
              { label: "Past SLA", value: breached, href: "/workbench", tone: breached ? "danger" : undefined, verdict: breached ? "Open the queue to act on them." : "No open item has breached its SLA." },
              { label: "Systems healthy", value: healthy, unit: ` of ${systems.length}`, href: "/data?tab=systems", tone: healthy < systems.length ? "warning" : undefined,
                verdict: healthy < systems.length ? "Open Systems to see which." : "Every connected system answers." },
            ]} />

            <SectionCard title="Jobs running" meta={active.length || undefined}>
              {active.length ? (
                <div className="aurora-runs__live">
                  {active.map((j) => (
                    <JobCard key={j.id} job={j} nowSec={nowSec} expanded systemName={j.system_id ? systemName.get(j.system_id) : undefined} />
                  ))}
                </div>
              ) : <EmptyState>No jobs running.</EmptyState>}
            </SectionCard>

            <SectionCard title="Needs attention" meta={`${critTotal.toLocaleString()} critical and ${highTotal.toLocaleString()} high open`}
              action={<Link className="ui-link" href={findingsHref({})}>All findings</Link>} flush>
              {inbox.length ? (
                <ol className="ui-ranked">
                  {inbox.map((f) => (
                    <li key={f.id}>
                      <Link href={findingsHref({ version_id: f.version_id, module: f.module, check_id: f.check_id, finding: f.id })}>
                        <StatusBadge status={f.severity === "critical" ? "critical" : "high"} />
                        <span className="ui-ranked__title">{f.business_name ?? f.details?.message ?? f.check_id}</span>
                        <span className="ui-ranked__num aurora-number">{f.affected_count.toLocaleString()} record{f.affected_count === 1 ? "" : "s"}</span>
                        <span className="ui-ranked__meta">{formatModuleName(f.module)}, <Mono>{f.check_id}</Mono>, found {relativeTime(f.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState>No open critical or high findings.</EmptyState>}
            </SectionCard>

            <SectionCard title="Resolution by type" meta={resolution.length || undefined} flush>
              <DataTable<ResolutionRow>
                ariaLabel="Stewardship items and average time to resolve, by type"
                columns={resolutionColumns}
                data={resolution}
                getRowId={(r) => r.type}
                empty={metricsQ.isLoading ? "Loading resolution times" : "No stewardship items yet."}
              />
            </SectionCard>

            <SectionCard title="Stewardship queue" meta={`Newest ${Math.min(10, queue.length)} of ${queueTotal.toLocaleString()} open`}
              action={<Link className="ui-link" href="/workbench">Workbench</Link>} flush>
              {queue.length ? (
                <ul className="ui-ranked">
                  {queue.slice(0, 10).map((t) => (
                    <li key={t.id}>
                      <Link href="/workbench" className="ui-ranked__row">
                        <span className="ui-micro">{relativeTime(t.created_at)}</span>
                        <span className="ui-ranked__title">{typeLabel(t.item_type)}</span>
                        <span className="ui-ranked__num">{t.ai_recommendation ? "Suggested fix" : "Manual"}</span>
                        <span className="ui-ranked__meta"><Mono>{t.source_id}</Mono></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState>Nothing in the stewardship queue.</EmptyState>}
            </SectionCard>

            <SectionCard title="Systems" action={<Link className="ui-link" href="/data?tab=systems">Manage systems</Link>} flush>
              {systems.length ? (
                <ul className="ui-ranked">
                  {systems.map((s) => {
                    const h = HEALTH[s.health_status ?? "unknown"] ?? HEALTH.unknown;
                    return (
                      <li key={s.id}>
                        <Link href="/data?tab=systems" className="ui-ranked__row">
                          <StatusBadge status={s.is_active ? h.status : "idle"}>{s.is_active ? h.label : "Inactive"}</StatusBadge>
                          <span className="ui-ranked__title">{s.name}</span>
                          <span className="ui-ranked__num">{s.last_sync_at ? `synced ${relativeTime(s.last_sync_at)}` : "never synced"}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <EmptyState action={<Link className="ui-link" href="/data?tab=systems">Connect a system</Link>}>No systems connected.</EmptyState>}
            </SectionCard>
          </>
        )}
    </div>
  );
}
