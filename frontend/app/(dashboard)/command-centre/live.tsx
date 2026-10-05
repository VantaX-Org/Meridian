"use client";

/**
 * Live operations: what is running now and what needs a decision. Every
 * figure is read from the API; nothing here is estimated except job
 * progress, which is elapsed time against that system's own average run.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Banner, EmptyState, Metric, MetricStrip, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, type Status,
} from "@/components/ui-core";
import { useNowSec } from "@/hooks/use-now";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getFindings } from "@/lib/api/findings";
import { getSystems, getSyncRuns } from "@/lib/api/systems";
import { getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { SAPSystem, SyncRun } from "@/types/api";

function syncStatus(s: SAPSystem["last_sync_status"]): { status: Status; label: string } {
  if (!s) return { status: "idle", label: "Never synced" };
  if (s === "running") return { status: "running", label: "Syncing" };
  if (s === "completed" || s === "complete") return { status: "ok", label: "Synced" };
  if (s === "failed") return { status: "failed", label: "Last sync failed" };
  return { status: "idle", label: "Scheduled" };
}

/** Elapsed time against this system's own average completed run, capped at
 * 95% so a run never reads as done before it is. No average, no percentage. */
function jobProgress(r: SyncRun, avgDurationMs: number | null, nowMs: number): number | null {
  if (r.completed_at) return 100;
  if (!avgDurationMs || avgDurationMs <= 0) return null;
  return Math.min(95, Math.round(((nowMs - new Date(r.started_at).getTime()) / avgDurationMs) * 100));
}

const findingsHref = (p: Record<string, string>) => `/analyse?${new URLSearchParams({ tab: "findings", ...p })}`;

export function LiveOperationsPage() {
  const nowMs = useNowSec(true, 5_000) * 1000;

  const mdmQ = useQuery({ queryKey: ["mdm.dashboard"], queryFn: getMdmDashboard });
  const critQ = useQuery({
    queryKey: ["findings.list", { severity: "critical", limit: 50 }],
    queryFn: () => getFindings({ severity: "critical", limit: 50 }),
  });
  const highQ = useQuery({
    queryKey: ["findings.list", { severity: "high", limit: 50 }],
    queryFn: () => getFindings({ severity: "high", limit: 50 }),
  });
  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  // 200 is the stewardship API's own page cap, so "at risk" sees as much of the open queue as one call allows.
  const stewardQ = useQuery({
    queryKey: ["stewardship.queue", { status: "open", limit: 200 }],
    queryFn: () => getQueueItems({ status: "open", limit: 200 }),
  });

  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const runs = useQueries({
    queries: systems.map((s) => ({ queryKey: ["systems.runs", s.id], queryFn: () => getSyncRuns(s.id, 5) })),
  });
  const runData = runs.map((r) => r.data);

  const activeJobs = useMemo(() => {
    const out: { run: SyncRun; systemName: string; avgDurationMs: number | null }[] = [];
    systems.forEach((s, i) => {
      const list = runData[i] ?? [];
      const done = list.filter((r) => r.completed_at)
        .map((r) => new Date(r.completed_at as string).getTime() - new Date(r.started_at).getTime())
        .filter((ms) => ms > 0);
      const avgDurationMs = done.length ? done.reduce((a, b) => a + b, 0) / done.length : null;
      for (const r of list) if (!r.completed_at) out.push({ run: r, systemName: s.name, avgDurationMs });
    });
    return out;
    // runData is a fresh array each render; its members are stable query results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systems, ...runData]);

  const loading = mdmQ.isLoading || critQ.isLoading || highQ.isLoading || systemsQ.isLoading || stewardQ.isLoading;
  const error = mdmQ.error || critQ.error || highQ.error || systemsQ.error || stewardQ.error;

  const latest = mdmQ.data?.latest;
  const trend = mdmQ.data?.trend ?? [];
  const prev = trend.length >= 2 ? trend[trend.length - 2].mdm_health_score : null;
  const health = latest?.mdm_health_score ?? null;
  const delta = health !== null && prev !== null ? Number((health - prev).toFixed(1)) : null;
  const critTotal = critQ.data?.total ?? 0;
  const highTotal = highQ.data?.total ?? 0;
  const inbox = [...(critQ.data?.findings ?? []), ...(highQ.data?.findings ?? [])].slice(0, 8);
  const queue = stewardQ.data?.items ?? [];
  // Counted over the fetched page (up to 200 items), not a server total.
  const atRisk = queue.filter((t) => t.sla_hours !== null && t.due_at
    && new Date(t.due_at).getTime() - nowMs < t.sla_hours * 0.5 * 3600 * 1000).length;

  return (
    <div className="ui-page">
      <PageHeader
        title="Live operations"
        summary={loading || error ? undefined
          : `${systems.length} system${systems.length === 1 ? "" : "s"} connected, ${activeJobs.length} job${activeJobs.length === 1 ? "" : "s"} running, ${atRisk} queue item${atRisk === 1 ? "" : "s"} close to breaching SLA.`}
      />

      {loading ? <TableSkeleton rows={8} label="Loading live operations" />
        : error ? <Banner tone="danger" title="Live operations could not be read">{(error as Error).message}</Banner>
        : (
          <>
            <MetricStrip label="Live figures">
              <Metric label="MDM health" value={health === null ? null : health.toFixed(1)}
                delta={delta === null ? null : { value: delta, unit: " pts", good: "up" }} />
              <Metric label="Open critical" value={critTotal} tone={critTotal ? "danger" : "default"} href={findingsHref({ severity: "critical" })} />
              <Metric label="Open high" value={highTotal} tone={highTotal ? "warning" : "default"} href={findingsHref({ severity: "high" })} />
              <Metric label="Jobs running" value={activeJobs.length} />
              <Metric label="SLA at risk" value={atRisk} tone={atRisk ? "warning" : "default"} href="/workbench" />
              <Metric label="Open queue" value={stewardQ.data?.total ?? queue.length} href="/workbench" />
            </MetricStrip>

            <div className="ui-columns">
              <div className="ui-stack">
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

                <SectionCard title="Stewardship queue" meta={`Newest ${Math.min(8, queue.length)} of ${(stewardQ.data?.total ?? queue.length).toLocaleString()} open`}
                  action={<Link className="ui-link" href="/workbench">Workbench</Link>} flush>
                  {queue.length ? (
                    <ul className="ui-ranked">
                      {queue.slice(0, 8).map((t) => (
                        <li key={t.id}>
                          <div className="ui-ranked__row">
                            <span className="ui-micro">{relativeTime(t.created_at)}</span>
                            <span className="ui-ranked__title">{t.item_type.replace(/_/g, " ")}</span>
                            <span className="ui-ranked__num">{t.ai_recommendation ? "Suggested fix" : "Manual"}</span>
                            <span className="ui-ranked__meta"><Mono>{t.source_id}</Mono></span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState>Nothing in the stewardship queue.</EmptyState>}
                </SectionCard>
              </div>

              <div className="ui-stack">
                <SectionCard title="Jobs running" meta={activeJobs.length ? "Progress is elapsed time against the system's average run" : undefined}>
                  {activeJobs.length ? (
                    <ul className="ui-ranked">
                      {activeJobs.map(({ run, systemName, avgDurationMs }) => {
                        const p = jobProgress(run, avgDurationMs, nowMs);
                        return (
                          <li key={run.id}>
                            <div className="ui-ranked__row" style={{ paddingInline: 0 }}>
                              <StatusBadge status="running">{p === null ? "Running" : `${p}%`}</StatusBadge>
                              <span className="ui-ranked__title">{systemName}</span>
                              <span className="ui-ranked__num">started {relativeTime(run.started_at)}</span>
                              <span className="ui-ranked__meta">Run <Mono>{run.id.slice(0, 8)}</Mono>{p === null ? ", first run, no average yet" : ""}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <EmptyState>No jobs running.</EmptyState>}
                </SectionCard>

                <SectionCard title="Systems" action={<Link className="ui-link" href="/data?tab=systems">Manage systems</Link>}>
                  {systems.length ? (
                    <ul className="ui-ranked">
                      {systems.map((s) => {
                        const st = syncStatus(s.last_sync_status);
                        return (
                          <li key={s.id}>
                            <div className="ui-ranked__row" style={{ paddingInline: 0 }}>
                              <StatusBadge status={s.is_active ? st.status : "idle"}>{s.is_active ? st.label : "Inactive"}</StatusBadge>
                              <span className="ui-ranked__title">{s.name}</span>
                              <span className="ui-ranked__num">{s.last_sync_at ? relativeTime(s.last_sync_at) : "never"}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <EmptyState action={<Link className="ui-link" href="/data?tab=systems">Connect a system</Link>}>No systems connected.</EmptyState>}
                </SectionCard>
              </div>
            </div>
          </>
        )}
    </div>
  );
}
