"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  PageHead,
  KPI,
  SectionHeader,
  StatusDot,
  PriorityChip,
  SevTag,
} from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getFindings } from "@/lib/api/findings";
import { getSystems, getSyncRuns } from "@/lib/api/systems";
import { getQueueItems } from "@/lib/api/stewardship";
import { relativeTime } from "@/lib/format";
import type { Finding, SAPSystem, SyncRun } from "@/types/api";

function statusToDot(s: SAPSystem["last_sync_status"]): "healthy" | "degraded" | "down" | "scheduled" {
  if (!s) return "scheduled";
  if (s === "running" || s === "completed" || s === "complete") return "healthy";
  if (s === "failed") return "down";
  return "scheduled";
}

/** Progress estimate: elapsed time vs this system's own average completed-run
 * duration, capped at 95% (never 100% before the run actually completes).
 * Without a real average (e.g. this system's first-ever run) there's no
 * meaningful percentage to show — callers should fall back to elapsed time
 * as a duration, not a percentage; a fixed 90% for any run over 90s was
 * indistinguishable from a genuinely hung job. */
function jobProgress(r: SyncRun, avgDurationMs: number | null): number | null {
  if (r.completed_at) return 100;
  if (!avgDurationMs || avgDurationMs <= 0) return null;
  const elapsed = Date.now() - new Date(r.started_at).getTime();
  return Math.min(95, Math.round((elapsed / avgDurationMs) * 100));
}

export default function CommandCentrePage() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const mdmQ = useQuery({
    queryKey: ["mdm.dashboard"],
    queryFn: getMdmDashboard,
  });
  const findingsQ = useQuery({
    queryKey: ["findings.list", { severity: "critical", limit: 50 }],
    queryFn: () => getFindings({ severity: "critical", limit: 50 }),
  });
  const highFindingsQ = useQuery({
    queryKey: ["findings.list", { severity: "high", limit: 50 }],
    queryFn: () => getFindings({ severity: "high", limit: 50 }),
  });
  const systemsQ = useQuery({
    queryKey: ["systems.list"],
    queryFn: getSystems,
  });
  // limit: 200 is the API's own hard cap (Query(50, le=200) in
  // api/routes/stewardship.py) — the highest this endpoint allows in one
  // page, used here so the "at risk" filter below sees as much of the real
  // open queue as the API can return in a single call, not an arbitrary
  // small page size.
  const stewardQ = useQuery({
    queryKey: ["stewardship.queue", { status: "open", limit: 200 }],
    queryFn: () => getQueueItems({ status: "open", limit: 200 }),
  });

  const systems: SAPSystem[] = systemsQ.data ?? [];
  const runs = useQueries({
    queries: systems.map((s) => ({
      queryKey: ["systems.runs", s.id],
      queryFn: () => getSyncRuns(s.id, 5),
      enabled: systems.length > 0,
    })),
  });

  const isLoading =
    mdmQ.isLoading ||
    findingsQ.isLoading ||
    highFindingsQ.isLoading ||
    systemsQ.isLoading ||
    stewardQ.isLoading;

  const error = mdmQ.error || findingsQ.error || highFindingsQ.error || systemsQ.error || stewardQ.error;

  const activeJobs = useMemo<{ run: SyncRun; systemName: string; avgDurationMs: number | null }[]>(() => {
    const out: { run: SyncRun; systemName: string; avgDurationMs: number | null }[] = [];
    systems.forEach((s, i) => {
      const list = runs[i]?.data ?? [];
      const completedDurations = list
        .filter((r) => r.completed_at)
        .map((r) => new Date(r.completed_at as string).getTime() - new Date(r.started_at).getTime())
        .filter((ms) => ms > 0);
      const avgDurationMs = completedDurations.length > 0
        ? completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length
        : null;
      for (const r of list) if (!r.completed_at) out.push({ run: r, systemName: s.name, avgDurationMs });
    });
    return out;
  }, [systems, runs]);

  if (isLoading) {
    return (
      <>
        <PageHead title="Command Centre" route="Aurora · /command-centre" sub="Loading live view…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 18 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Command Centre" route="Aurora · /command-centre" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach one of the live endpoints (mdm/findings/systems/stewardship).
        </div>
      </>
    );
  }

  const mdmLatest = mdmQ.data?.latest;
  const trend = mdmQ.data?.trend ?? [];
  const previousDqs = trend.length >= 2 ? trend[trend.length - 2].mdm_health_score : null;
  const dqs = mdmLatest?.mdm_health_score ?? 0;
  const dqsDelta = previousDqs !== null ? Number((dqs - previousDqs).toFixed(1)) : null;

  const criticals = findingsQ.data?.findings ?? [];
  const highs = highFindingsQ.data?.findings ?? [];
  const inbox: Finding[] = [...criticals, ...highs].slice(0, 8);

  const sla = mdmLatest?.steward_sla_compliance_pct ?? 0;
  // slaAtRisk is a filter over the fetched page, not a server-computed
  // total — accurate up to the API's 200-item cap (see stewardQ above);
  // a tenant with more than 200 open items could still undercount this
  // specific figure. decisions24h (the "Open queue" KPI) uses the list
  // response's own `total`, so it doesn't share that limitation.
  const slaAtRisk = stewardQ.data?.items.filter((t) => t.sla_hours !== null && t.due_at && new Date(t.due_at).getTime() - Date.now() < t.sla_hours * 0.5 * 3600 * 1000).length ?? 0;
  const decisions24h = stewardQ.data?.total ?? 0;
  const clock = now ? now.toLocaleTimeString() : "—:—:—";

  return (
    <>
      <PageHead
        title="Command Centre"
        route="Aurora · /command-centre"
        sub={
          <>
            Live view across <strong style={{ color: "var(--mn-ink-700)" }}>{systems.length} systems</strong> ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{Math.round(sla)}% SLA</strong> ·{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{slaAtRisk} at risk</strong>.
          </>
        }
        actions={
          <>
            <span className="mn-pill">
              <span className="pdot" /> Live · {clock}
            </span>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI
          label="Estate DQS"
          value={dqs.toFixed(1)}
          delta={dqsDelta ?? undefined}
          deltaUnit=" pts"
          tone={dqsDelta === null || dqsDelta >= 0 ? "pos" : "neg"}
          href="/"
        />
        <KPI label="Open critical" value={findingsQ.data?.total ?? criticals.length} tone="neg" href="/findings?severity=critical" />
        <KPI label="Open high" value={highFindingsQ.data?.total ?? highs.length} tone="warn" href="/findings?severity=high" />
        <KPI label="Active jobs" value={activeJobs.length} tone={activeJobs.length > 0 ? "warn" : "pos"} />
        <KPI label="SLA at risk" value={slaAtRisk} tone={slaAtRisk > 0 ? "warn" : "pos"} />
        <KPI label="Open queue" value={decisions24h} tone="pos" href="/workbench" />
      </div>

      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad">
            <SectionHeader
              title="Systems · live"
              caption="Connection health across the estate"
              right={
                <Link href="/systems" className="mn-link">
                  Systems <ArrowRight size={11} />
                </Link>
              }
            />
            <div className="mn-loads">
              {systems.map((s) => (
                <div key={s.id} className="mn-load">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mn-ink-900)" }}>{s.name}</span>
                    <span
                      className="mn-tabular"
                      style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}
                    >
                      {s.last_sync_at ? relativeTime(s.last_sync_at) : "never"}
                    </span>
                  </div>
                  <div style={{ height: 5, background: "rgba(15,23,42,0.06)", borderRadius: 999 }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${s.is_active ? 65 : 0}%`,
                        background:
                          statusToDot(s.last_sync_status) === "healthy"
                            ? "var(--mn-pos)"
                            : statusToDot(s.last_sync_status) === "down"
                              ? "var(--mn-neg)"
                              : "var(--mn-warn)",
                        borderRadius: 999,
                        transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <StatusDot status={statusToDot(s.last_sync_status)} />
                  </div>
                </div>
              ))}
              {systems.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)", padding: 16 }}>No systems connected.</div>
              )}
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Active jobs" caption={`${activeJobs.length} running`} />
            <div className="mn-jobs">
              {activeJobs.map(({ run, systemName, avgDurationMs }) => {
                const progress = jobProgress(run, avgDurationMs);
                return (
                <div key={run.id} className="mn-job">
                  <div className="mn-job-head">
                    <PriorityChip p="P2" />
                    <span style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                      {run.id.slice(0, 8)}
                    </span>
                    <span style={{ flex: 1, color: "var(--mn-ink-900)", fontSize: 13, fontWeight: 500 }}>
                      {systemName}
                    </span>
                    <span
                      className="mn-tabular"
                      style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}
                    >
                      {relativeTime(run.started_at)}
                    </span>
                  </div>
                  <div className="mn-job-progress">
                    <div className="mn-job-bar">
                      {/* No historical average for this system yet (first run) —
                          nothing meaningful to show as a percentage of duration. */}
                      <span style={{ width: progress !== null ? `${progress}%` : "100%", opacity: progress !== null ? 1 : 0.35 }} />
                    </div>
                    <span
                      className="mn-tabular"
                      style={{ font: "600 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-primary-700)" }}
                    >
                      {progress !== null ? `${progress}%` : "—"}
                    </span>
                  </div>
                </div>
                );
              })}
              {activeJobs.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)", padding: 16 }}>No active jobs.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-7">
          <div className="mn-card mn-card-pad">
            <SectionHeader
              title="Inbox"
              caption={`${findingsQ.data?.total ?? criticals.length} critical · ${highFindingsQ.data?.total ?? highs.length} high`}
              right={
                <Link href="/findings" className="mn-link">
                  Findings <ArrowRight size={11} />
                </Link>
              }
            />
            <div style={{ marginTop: 10 }}>
              {inbox.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto auto",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 0",
                    borderBottom: "1px dashed var(--mn-line-2)",
                  }}
                >
                  <SevTag sev={f.severity === "critical" ? "critical" : f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low"} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", fontSize: 13 }}>
                      {f.details?.message ?? f.check_id}
                    </div>
                    <div
                      style={{
                        font: "500 11px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-400)",
                        marginTop: 3,
                      }}
                    >
                      {f.module} · {f.check_id}
                    </div>
                  </div>
                  <span
                    className="mn-tabular"
                    style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {f.affected_count.toLocaleString()}
                  </span>
                  <span
                    className="mn-tabular"
                    style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}
                  >
                    {relativeTime(f.created_at)}
                  </span>
                </div>
              ))}
              {inbox.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)", padding: 16 }}>No open criticals or highs.</div>
              )}
            </div>
          </div>
        </div>
        <div className="mn-col-5">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader
              title="Decision stream"
              caption={`Last ${stewardQ.data?.items.length ?? 0} stewardship items`}
              right={
                <Link href="/workbench" className="mn-link">
                  Workbench <ArrowRight size={11} />
                </Link>
              }
            />
            <ul className="mn-decision-stream">
              {(stewardQ.data?.items ?? []).slice(0, 8).map((t) => (
                <li key={t.id}>
                  <span className="t mn-tabular">{relativeTime(t.created_at)}</span>
                  <span
                    className="who"
                    style={{
                      background: t.ai_recommendation ? "var(--mn-primary-50)" : "var(--mn-pos-bg)",
                      color: t.ai_recommendation ? "var(--mn-primary-700)" : "var(--mn-pos)",
                    }}
                  >
                    {t.ai_recommendation ? "MODEL" : "QUEUE"}
                  </span>
                  <span style={{ color: "var(--mn-ink-700)", fontSize: 12.5 }}>
                    {t.item_type.replace(/_/g, " ")} · {t.source_id}
                  </span>
                </li>
              ))}
              {(stewardQ.data?.items.length ?? 0) === 0 && (
                <li style={{ color: "var(--mn-ink-400)", display: "block", padding: 8 }}>
                  Nothing in the stewardship queue.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
