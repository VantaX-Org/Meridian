"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { Sparkline } from "@/components/meridian/charts";
import { BookmarkIcon, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getMdmDashboard, getMdmHistory } from "@/lib/api/mdm-metrics";
import { getSystems, getSyncRuns } from "@/lib/api/systems";
import { getCleaningMetrics } from "@/lib/api/cleaning";
import { getMetrics as getStewardshipMetrics } from "@/lib/api/stewardship";
import { downloadCsv, saveView } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { MdmMetric, SAPSystem, SyncRun } from "@/types/api";

const TABS = [
  { k: "mdm",          l: "MDM Health",   d: "Vendor · Customer · Material · Employee" },
  { k: "operational",  l: "Operational",  d: "Run cadence, latency, failures" },
  { k: "impact",       l: "Impact",       d: "Hours saved, throughput, decisions" },
  { k: "predictive",   l: "Predictive",   d: "Forecast trend (preview)" },
  { k: "prescriptive", l: "Prescriptive", d: "Next-best plays (endpoint pending)" },
] as const;

type TabKey = (typeof TABS)[number]["k"];

/* ── MDM Health ───────────────────────────────────────────────── */
function MDMPanel() {
  const dashQ = useQuery({
    queryKey: ["mdm.dashboard"],
    queryFn: getMdmDashboard,
  });
  const histQ = useQuery({
    queryKey: ["mdm.history", { days: 30 }],
    queryFn: () => getMdmHistory({ days: 30 }),
  });

  // All hooks must run before any conditional return.
  const history = histQ.data?.history ?? [];

  const byDomain = useMemo(() => {
    const m = new Map<string, MdmMetric[]>();
    for (const h of history) {
      if (!h.domain) continue;
      const arr = m.get(h.domain) ?? [];
      arr.push(h);
      m.set(h.domain, arr);
    }
    for (const [k, arr] of m.entries()) {
      m.set(
        k,
        arr.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)),
      );
    }
    return m;
  }, [history]);

  if (dashQ.isLoading || histQ.isLoading) {
    return <Skeleton className="h-[420px] rounded-[10px]" />;
  }
  if (dashQ.error || histQ.error) {
    return (
      <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
        Could not reach <code>/api/v1/mdm/dashboard</code>.
      </div>
    );
  }

  const dash = dashQ.data!;
  const latest = dash.latest;
  const domains = Array.from(byDomain.entries());

  const composite = latest?.mdm_health_score ?? 0;
  const totalDups = domains.reduce((a, [, h]) => a + (h.at(-1)?.backlog_count ?? 0), 0);
  const totalRecords = domains.reduce((a, [, h]) => a + (h.at(-1)?.golden_record_count ?? 0), 0);

  return (
    <>
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="MDM composite" value={composite.toFixed(1)} tone="pos" />
        <KPI label="Total golden records" value={totalRecords.toLocaleString()} />
        <KPI label="Total backlog" value={totalDups.toLocaleString()} tone={totalDups > 0 ? "warn" : "pos"} />
        <KPI label="Domains tracked" value={domains.length} hint={domains.map(([d]) => d).join(" · ")} />
      </div>

      {domains.length > 0 ? (
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {domains.map(([name, series]) => {
            const cur = series.at(-1);
            if (!cur) return null;
            const score = cur.mdm_health_score;
            const col =
              score >= 90
                ? "var(--mn-pos)"
                : score >= 80
                  ? "var(--mn-primary)"
                  : "var(--mn-warn)";
            return (
              <div key={name} className="mn-card mn-card-pad mn-mdm-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <span className="mn-eyebrow">{name}</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                      <span
                        className="mn-tabular"
                        style={{ font: "600 34px/1 'Inter Tight'", letterSpacing: "-0.025em", color: col }}
                      >
                        {score.toFixed(0)}
                      </span>
                      <span style={{ font: "500 13px/1 'Inter Tight'", color: "var(--mn-ink-300)" }}>/ 100</span>
                    </div>
                  </div>
                  <div style={{ width: 100, height: 36 }}>
                    <Sparkline
                      data={series.map((s) => s.mdm_health_score)}
                      width={100}
                      height={36}
                      stroke={col}
                    />
                  </div>
                </div>
                <div className="mn-mdm-stats">
                  <div>
                    <span className="mn-eyebrow">Coverage</span>
                    <span className="v mn-tabular">{cur.golden_record_coverage_pct.toFixed(0)}%</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Avg match</span>
                    <span className="v mn-tabular">{Math.round(cur.avg_match_confidence * 100)}%</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Records</span>
                    <span className="v mn-tabular">{cur.golden_record_count.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Backlog</span>
                    <span
                      className="v mn-tabular"
                      style={{ color: cur.backlog_count > 0 ? "var(--mn-warn)" : "var(--mn-ink-700)" }}
                    >
                      {cur.backlog_count}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          No domain-level MDM snapshots yet. Composite score:{" "}
          <strong>{composite.toFixed(1)}</strong>.
        </div>
      )}
    </>
  );
}

/* ── Operational ──────────────────────────────────────────────── */
function OperationalPanel() {
  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  const systems: SAPSystem[] = systemsQ.data ?? [];
  const runsResults = useQueries({
    queries: systems.map((s) => ({
      queryKey: ["systems.runs", s.id],
      queryFn: () => getSyncRuns(s.id, 50),
      enabled: systems.length > 0,
    })),
  });
  const loading = systemsQ.isLoading || runsResults.some((r) => r.isLoading);

  // All hooks must run before any conditional return.
  const allRuns = useMemo<SyncRun[]>(() => {
    const out: SyncRun[] = [];
    runsResults.forEach((r) => (r.data ?? []).forEach((x) => out.push(x)));
    return out.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [runsResults]);

  const throughput = useMemo(() => {
    const buckets = new Array(10).fill(0);
    const dayMs = 86400 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const r of allRuns) {
      const t = new Date(r.started_at).getTime();
      for (let i = 0; i < 10; i++) {
        const start = today.getTime() - (9 - i) * dayMs;
        const end = start + dayMs;
        if (t >= start && t < end) {
          buckets[i] += 1;
          break;
        }
      }
    }
    return buckets;
  }, [allRuns]);

  if (loading && allRuns.length === 0) {
    return <Skeleton className="h-[420px] rounded-[10px]" />;
  }

  const cutoff24h = Date.now() - 24 * 3600 * 1000;
  const recent = allRuns.filter((r) => new Date(r.started_at).getTime() >= cutoff24h);
  const completed = allRuns.filter((r) => r.completed_at);
  const durations = completed
    .map((r) => (new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime()) / 1000)
    .sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
  const failures24h = recent.filter((r) => r.status === "failed").length;
  const runsPerDay = recent.length;

  return (
    <>
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Runs · 24h" value={runsPerDay} hint={`${recent.filter(r => r.status === "completed").length} ok`} tone="pos" />
        <KPI label="P50 duration" value={`${Math.round(p50)}s`} tone="pos" />
        <KPI label="P95 duration" value={`${Math.round(p95)}s`} hint="long-tail" tone="warn" />
        <KPI label="Failures · 24h" value={failures24h} tone={failures24h > 0 ? "neg" : "pos"} />
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Throughput" caption="Runs per day · last 10 days" />
            <div style={{ marginTop: 14 }}>
              {throughput.some((v) => v > 0) ? (
                <Sparkline data={throughput} width={620} height={120} stroke="var(--mn-primary)" pulse />
              ) : (
                <div style={{ padding: 16, color: "var(--mn-ink-400)" }}>No run history yet.</div>
              )}
            </div>
          </div>
        </div>
        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Recent failures" caption={`${failures24h} in the last 24h`} />
            <div style={{ marginTop: 10 }}>
              {recent
                .filter((r) => r.status === "failed")
                .slice(0, 5)
                .map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px dashed var(--mn-line-2)",
                    }}
                  >
                    <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", fontSize: 13 }}>
                      {r.error_detail ?? "Failure"}
                    </div>
                    <div
                      style={{
                        font: "500 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-400)",
                        marginTop: 3,
                      }}
                    >
                      {relativeTime(r.started_at)}
                    </div>
                  </div>
                ))}
              {failures24h === 0 && (
                <div style={{ color: "var(--mn-ink-400)" }}>No failures in the last 24h.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Impact ────────────────────────────────────────────────────── */
function ImpactPanel() {
  const cleanQ = useQuery({
    queryKey: ["cleaning.metrics"],
    queryFn: () => getCleaningMetrics(),
  });
  const stewardQ = useQuery({
    queryKey: ["stewardship.metrics"],
    queryFn: getStewardshipMetrics,
  });

  if (cleanQ.isLoading || stewardQ.isLoading) {
    return <Skeleton className="h-[420px] rounded-[10px]" />;
  }
  if (cleanQ.error || stewardQ.error) {
    return (
      <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
        Could not reach <code>/api/v1/cleaning/metrics</code> or <code>/api/v1/stewardship/metrics</code>.
      </div>
    );
  }

  const totals = cleanQ.data?.totals;
  const metrics = stewardQ.data!;

  const autoSharePct =
    totals && totals.detected > 0
      ? Math.round(((totals.auto_approved ?? 0) / totals.detected) * 100)
      : 0;
  const resolvedTotal =
    (totals?.approved ?? 0) + (totals?.auto_approved ?? 0) + (totals?.applied ?? 0);

  const summary = [
    {
      area: "Cleaning · auto-applied",
      value: `${totals?.auto_approved ?? 0} of ${totals?.detected ?? 0}`,
      pct: autoSharePct,
    },
    {
      area: "Stewardship · SLA",
      value: `${Math.round(metrics.sla_compliance_rate * 100)}%`,
      pct: Math.round(metrics.sla_compliance_rate * 100),
    },
    {
      area: "Suggestion acceptance",
      value:
        metrics.ai_acceptance_rate !== null
          ? `${Math.round(metrics.ai_acceptance_rate * 100)}%`
          : "—",
      pct: metrics.ai_acceptance_rate !== null ? Math.round(metrics.ai_acceptance_rate * 100) : 0,
    },
    {
      area: "Cleaning · approved",
      value: `${totals?.approved ?? 0} of ${totals?.detected ?? 0}`,
      pct:
        totals && totals.detected > 0
          ? Math.round(((totals.approved ?? 0) / totals.detected) * 100)
          : 0,
    },
  ];

  return (
    <>
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Detected · cleaning" value={totals?.detected ?? 0} />
        <KPI label="Auto-resolved share" value={`${autoSharePct}%`} tone="pos" />
        <KPI label="Backlog" value={metrics.backlog_total} tone={metrics.backlog_total > 0 ? "warn" : "pos"} />
        <KPI label="Resolved · all-time" value={resolvedTotal.toLocaleString()} tone="pos" />
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Operational uplift" caption="Where Meridian is moving the needle" />
            <div className="mn-impact-list">
              {summary.map((s) => (
                <div key={s.area} className="mn-impact-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--mn-ink-900)", fontSize: 13 }}>{s.area}</div>
                    <div
                      style={{
                        font: "500 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-400)",
                        marginTop: 3,
                      }}
                    >
                      {s.value}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 220,
                      height: 6,
                      background: "rgba(15,23,42,0.06)",
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${s.pct}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, var(--mn-primary), var(--mn-pos))",
                        borderRadius: 999,
                        transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                      }}
                    />
                  </div>
                  <span
                    className="mn-tabular"
                    style={{
                      font: "600 14px/1 'Inter Tight'",
                      color: "var(--mn-ink-900)",
                      minWidth: 36,
                      textAlign: "right",
                    }}
                  >
                    {s.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Throughput summary" caption="Across cleaning + stewardship" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginTop: 14 }}>
              <div>
                <div className="mn-eyebrow">Approved</div>
                <div className="mn-tabular" style={{ font: "600 22px/1 'Inter Tight'" }}>
                  {totals?.approved ?? 0}
                </div>
              </div>
              <div>
                <div className="mn-eyebrow">Rejected</div>
                <div className="mn-tabular" style={{ font: "600 22px/1 'Inter Tight'" }}>
                  {totals?.rejected ?? 0}
                </div>
              </div>
              <div>
                <div className="mn-eyebrow">Applied</div>
                <div className="mn-tabular" style={{ font: "600 22px/1 'Inter Tight'" }}>
                  {totals?.applied ?? 0}
                </div>
              </div>
              <div>
                <div className="mn-eyebrow">Rolled back</div>
                <div className="mn-tabular" style={{ font: "600 22px/1 'Inter Tight'" }}>
                  {totals?.rolled_back ?? 0}
                </div>
              </div>
            </div>
            <div className="mn-narrative" style={{ marginTop: 14, padding: 10 }}>
              <div className="ico"><SparklesIcon size={13} /></div>
              <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
                Throughput modelling will surface here once the impact endpoint lands.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Predictive ────────────────────────────────────────────────── */
function PredictivePanel() {
  const histQ = useQuery({
    queryKey: ["mdm.history", { days: 30 }],
    queryFn: () => getMdmHistory({ days: 30 }),
  });

  if (histQ.isLoading) {
    return <Skeleton className="h-72 rounded-[10px]" />;
  }
  if (histQ.error) {
    return (
      <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
        Could not reach <code>/api/v1/mdm/history</code>.
      </div>
    );
  }

  const history = histQ.data?.history ?? [];
  const composite = history.filter((h) => !h.domain).slice().reverse();
  const series = composite.map((h) => h.mdm_health_score);

  if (series.length < 5) {
    return (
      <div className="mn-card mn-card-pad" style={{ color: "var(--mn-ink-500)", textAlign: "center" }}>
        Need at least 5 historical snapshots to surface a trend.
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--mn-ink-400)" }}>
          Predictive forecasting (confidence band, per-module risk) requires a dedicated
          backend endpoint — not yet wired.
        </div>
      </div>
    );
  }

  const current = series.at(-1) ?? 0;
  const window = series.slice(-7);
  const avgDelta = (window.at(-1)! - window[0]) / Math.max(window.length - 1, 1);
  const projected = +(current + avgDelta * 7).toFixed(1);
  const horizonDelta = +(projected - current).toFixed(1);

  return (
    <>
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Current composite" value={current.toFixed(1)} tone="pos" />
        <KPI label="Projected · 7 snapshots" value={projected.toFixed(1)} delta={horizonDelta} deltaUnit=" pts" tone={horizonDelta >= 0 ? "pos" : "neg"} />
        <KPI label="Snapshots used" value={series.length} hint="for the simple linear trend" />
        <KPI label="Window" value="last 7" hint="rolling delta" />
      </div>

      <div className="mn-card mn-card-pad">
        <SectionHeader
          title="DQS trend"
          caption="Linear projection from the last 7 composite snapshots — not a fitted model"
        />
        <div style={{ marginTop: 10 }}>
          <Sparkline data={series} width={1100} height={140} stroke="var(--mn-primary)" pulse />
        </div>
        <div className="mn-narrative" style={{ marginTop: 14, padding: 10 }}>
          <div className="ico"><SparklesIcon size={13} /></div>
          <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
            This is a placeholder for a real forecast. A dedicated <code>/api/v1/analytics/forecast</code> endpoint
            (with confidence intervals + per-module risk drivers) hasn&rsquo;t been built yet.
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Prescriptive ──────────────────────────────────────────────── */
function PrescriptivePanel() {
  return (
    <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-500)" }}>
      <div className="mn-coming-icon" style={{ margin: "12px auto" }}>
        <SparklesIcon size={20} />
      </div>
      <div className="mn-h1" style={{ fontSize: 18, marginTop: 8 }}>Prescriptive lens · endpoint pending</div>
      <p style={{ maxWidth: 480, margin: "8px auto 0", fontSize: 13, color: "var(--mn-ink-500)" }}>
        Ranked &ldquo;next-best-action&rdquo; plays need a dedicated{" "}
        <code>/api/v1/analytics/plays</code> endpoint that simulates rule promotions and
        survivorship policies against history. Not yet wired.
      </p>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */
export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>("mdm");

  // Page-level history query backs the Export action — it is the canonical
  // analytics dataset (per-domain MDM health snapshots over time).
  const exportQ = useQuery({
    queryKey: ["mdm.history", { days: 30 }],
    queryFn: () => getMdmHistory({ days: 30 }),
  });
  const exportRows = exportQ.data?.history ?? [];

  return (
    <>
      <PageHead
        title="Analytics"
        route="Analyse · /analytics"
        sub={
          <>
            Multi-lens analytical drilldown.{" "}
            <strong style={{ color: "var(--mn-primary-700)" }}>MDM Health</strong>,{" "}
            <strong style={{ color: "var(--mn-primary-700)" }}>Operational</strong> and{" "}
            <strong style={{ color: "var(--mn-primary-700)" }}>Impact</strong> read real data;
            forecasting + prescriptive plays surface when their endpoints land.
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => saveView("analytics", { tab })}
            >
              <BookmarkIcon /> Save view
            </button>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={() =>
                downloadCsv(
                  "meridian-mdm-history.csv",
                  exportRows.map((h) => ({
                    snapshot_date: h.snapshot_date,
                    domain: h.domain ?? "composite",
                    mdm_health_score: h.mdm_health_score,
                    golden_record_count: h.golden_record_count,
                    golden_record_coverage_pct: h.golden_record_coverage_pct,
                    avg_match_confidence: h.avg_match_confidence,
                    backlog_count: h.backlog_count,
                  })),
                )
              }
              disabled={exportRows.length === 0}
            >
              Export
            </button>
          </>
        }
      />

      <div className="mn-tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            className={`mn-tab ${tab === t.k ? "active" : ""}`}
            onClick={() => setTab(t.k)}
          >
            <span className="mn-tab-l">{t.l}</span>
            <span className="mn-tab-d">{t.d}</span>
          </button>
        ))}
      </div>

      <div className="mn-tab-panel" key={tab}>
        {tab === "mdm" && <MDMPanel />}
        {tab === "operational" && <OperationalPanel />}
        {tab === "impact" && <ImpactPanel />}
        {tab === "predictive" && <PredictivePanel />}
        {tab === "prescriptive" && <PrescriptivePanel />}
      </div>
    </>
  );
}
