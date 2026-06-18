"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getMiningGraph } from "@/lib/api/process-mining";
import { getVersions } from "@/lib/api/versions";
import type {
  MiningActivity,
  MiningTransition,
} from "@/lib/api/process-mining";
import type { Version } from "@/types/api";

function isComplete(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

function statusColour(s: MiningActivity["step_status"]): string {
  if (s === "green") return "var(--mn-pos)";
  if (s === "amber") return "var(--mn-warn)";
  return "var(--mn-neg)";
}

function ProcessGraph({
  activities,
  transitions,
}: {
  activities: MiningActivity[];
  transitions: MiningTransition[];
}) {
  const w = 920;
  const h = 320;
  if (activities.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--mn-ink-400)" }}>
        No process graph data for this module.
      </div>
    );
  }
  const layout = activities.map((a, i) => {
    const x = 60 + (i % 7) * 130;
    const y = 60 + Math.floor(i / 7) * 100;
    return { ...a, _x: x, _y: y };
  });
  const byId = Object.fromEntries(layout.map((n) => [n.id, n]));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet">
      {transitions.map((t, i) => {
        const a = byId[t.from];
        const b = byId[t.to];
        if (!a || !b) return null;
        const x1 = a._x + 80;
        const y1 = a._y + 22;
        const x2 = b._x;
        const y2 = b._y + 22;
        const mx = (x1 + x2) / 2;
        const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
        const sw = Math.max(1.5, Math.min(6, t.weight / 600));
        return (
          <g key={i}>
            <path
              d={path}
              fill="none"
              stroke="var(--mn-primary)"
              strokeOpacity="0.7"
              strokeWidth={sw}
              strokeLinecap="round"
            />
            <text
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2 - 6}
              textAnchor="middle"
              fontSize="9"
              fill="var(--mn-ink-400)"
              fontFamily="JetBrains Mono, monospace"
            >
              {t.weight}
            </text>
          </g>
        );
      })}
      {layout.map((a) => {
        const colour = statusColour(a.step_status);
        return (
          <g key={a.id}>
            <rect x={a._x} y={a._y} rx="9" width="80" height="44" fill="white" stroke={colour} strokeWidth="1.5" />
            <text
              x={a._x + 40}
              y={a._y + 18}
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="var(--mn-ink-900)"
              fontFamily="JetBrains Mono, monospace"
              letterSpacing="0.04em"
            >
              {a.label.length > 13 ? a.label.slice(0, 12) + "…" : a.label}
            </text>
            <text
              x={a._x + 40}
              y={a._y + 33}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill={colour}
              fontFamily="Inter Tight, sans-serif"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {a.affected_records.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ProcessPage() {
  const versionsQ = useQuery({
    queryKey: ["versions.list", { limit: 10 }],
    queryFn: () => getVersions({ limit: 10 }),
  });
  const latest = useMemo(
    () => versionsQ.data?.versions.find(isComplete),
    [versionsQ.data],
  );
  const availableModules = useMemo(
    () => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []),
    [latest],
  );
  const [module, setModule] = useState<string | null>(null);
  const effectiveModule = module ?? availableModules[0] ?? null;

  const graphQ = useQuery({
    queryKey: ["process.mining-graph", latest?.id, effectiveModule],
    queryFn: () => getMiningGraph(latest!.id, effectiveModule!),
    enabled: !!latest && !!effectiveModule,
  });

  if (versionsQ.isLoading) {
    return (
      <>
        <PageHead title="Process" route="Aurora · /process" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (!latest) {
    return (
      <>
        <PageHead title="Process" route="Aurora · /process" sub="Mining runs against a completed version." />
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          Run an analysis from <code>/run-sync</code> to populate process mining.
        </div>
      </>
    );
  }

  const graph = graphQ.data;
  const bottlenecks = (graph?.activities ?? [])
    .filter((a) => a.step_status !== "green")
    .sort((a, b) => b.affected_records - a.affected_records)
    .slice(0, 5);
  const variants = graph?.variants ?? [];
  const totalEvents = (graph?.activities ?? []).reduce((a, x) => a + x.affected_records, 0);

  return (
    <>
      <PageHead
        title="Process"
        route="Aurora · /process"
        sub={
          <>
            Mining version{" "}
            <span style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
              {latest.id.slice(0, 8)}
            </span>
            {" "}({latest.label ?? "Unlabelled run"}).
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Activities" value={graph?.activities.length ?? 0} />
        <KPI label="Transitions" value={graph?.transitions.length ?? 0} />
        <KPI label="Variants" value={variants.length} />
        <KPI
          label="Events"
          value={totalEvents.toLocaleString()}
          hint={effectiveModule ?? "—"}
        />
        <KPI
          label="Bottlenecks"
          value={bottlenecks.length}
          tone={bottlenecks.length > 0 ? "warn" : "pos"}
        />
      </div>

      <div className="mn-segment" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {availableModules.map((m) => (
          <button
            key={m}
            type="button"
            className={effectiveModule === m ? "on" : ""}
            onClick={() => setModule(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <SectionHeader
        title={`Active process · ${effectiveModule ?? "—"}`}
        caption={`${graph?.activities.length ?? 0} activities · ${graph?.transitions.length ?? 0} transitions`}
      />
      <div className="mn-card mn-card-pad" style={{ overflowX: "auto" }}>
        {graphQ.isLoading ? (
          <Skeleton className="h-72 rounded-[10px]" />
        ) : (
          <>
            <ProcessGraph activities={graph?.activities ?? []} transitions={graph?.transitions ?? []} />
            <div className="mn-graph-legend">
              <span><span className="ld" style={{ background: "var(--mn-pos)" }} /> Green</span>
              <span><span className="ld" style={{ background: "var(--mn-warn)" }} /> Amber</span>
              <span><span className="ld" style={{ background: "var(--mn-neg)" }} /> Red</span>
            </div>
          </>
        )}
      </div>

      <div className="mn-row mn-row-12" style={{ marginTop: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Bottlenecks" caption="Steps with the highest affected-records counts" />
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {bottlenecks.map((b) => {
                const passRate = b.avg_pass_rate ?? 0;
                return (
                  <div key={b.id} className="mn-bottleneck">
                    <div style={{ minWidth: 140 }}>
                      <div style={{ fontWeight: 600, color: "var(--mn-ink-900)" }}>{b.label}</div>
                      <div
                        style={{
                          font: "500 11.5px/1 'JetBrains Mono', monospace",
                          color: "var(--mn-ink-400)",
                          marginTop: 3,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {b.finding_count} findings
                      </div>
                    </div>
                    <div style={{ flex: 1, height: 10, background: "rgba(15,23,42,0.06)", borderRadius: 5, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(5, 100 - passRate * 100))}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, var(--mn-warn), var(--mn-neg))",
                          borderRadius: 5,
                          transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 80, textAlign: "right" }}>
                      <span
                        className="mn-tabular"
                        style={{ font: "600 18px/1 'Inter Tight'", color: "var(--mn-ink-900)" }}
                      >
                        {b.affected_records.toLocaleString()}
                      </span>
                      <div
                        style={{
                          font: "500 11px/1 'JetBrains Mono', monospace",
                          color: "var(--mn-ink-400)",
                          marginTop: 3,
                          letterSpacing: "0.04em",
                        }}
                      >
                        records
                      </div>
                    </div>
                  </div>
                );
              })}
              {bottlenecks.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)", padding: 12 }}>
                  No bottlenecks surfaced — every step is green.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Variants" caption={`${variants.length} discovered`} />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {variants.slice(0, 6).map((v) => {
                const stroke =
                  v.readiness === "green"
                    ? "var(--mn-pos)"
                    : v.readiness === "amber"
                      ? "var(--mn-warn)"
                      : "var(--mn-neg)";
                return (
                  <div
                    key={v.id}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: "var(--mn-card-2)",
                      borderLeft: `3px solid ${stroke}`,
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--mn-ink-900)", fontSize: 13 }}>{v.label}</div>
                    <div
                      style={{
                        font: "500 11px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-400)",
                        marginTop: 3,
                      }}
                    >
                      {v.activity_count} steps · coverage {Math.round(v.coverage * 100)}% · quality {Math.round(v.quality * 100)}%
                    </div>
                  </div>
                );
              })}
              {variants.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)" }}>No variants detected.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
