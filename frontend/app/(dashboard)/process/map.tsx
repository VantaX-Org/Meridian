"use client";

/**
 * Process map: the mined activity graph for one module of the latest complete
 * version. Each step carries the worst state of the checks on its fields
 * (red: a critical or high finding, or under 70% pass; amber: medium, or
 * under 95%; green otherwise), so colour on the map is defect state only.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banner, EmptyState, Metric, MetricStrip, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tabs, type Status,
} from "@/components/ui-core";
import { getMiningGraph, type MiningActivity, type MiningTransition, type MiningVariant } from "@/lib/api/process-mining";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";
import type { Version } from "@/types/api";

function isComplete(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

const STEP: Record<MiningActivity["step_status"], { status: Status; label: string }> = {
  green: { status: "ok", label: "Passing" },
  amber: { status: "medium", label: "Some fields failing" },
  red: { status: "critical", label: "Blocking failures" },
};

const READINESS: Record<MiningVariant["readiness"], string> = { green: "Ready", amber: "At risk", red: "Blocked" };

const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n * 100)}%`);
const plural = (n: number, w: string, many = `${w}s`) => `${n.toLocaleString()} ${n === 1 ? w : many}`;

/* Grid layout in activity order. Edges to the next node run side to side;
   forward skips arc over the row, backward steps arc under it, and edges to
   another row leave from the bottom and enter from the top. */
const COLS = 5, W = 156, H = 52, GX = 56, GY = 64, PAD = 16, TOP = 64;

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  let p: number[];
  if (a.y === b.y && b.x === a.x + W + GX) {
    p = [a.x + W, a.y + H / 2, a.x + W + GX / 3, a.y + H / 2, b.x - GX / 3, b.y + H / 2, b.x, b.y + H / 2];
  } else if (a.y === b.y) {
    const up = b.x > a.x, lift = Math.min(TOP, 24 + Math.abs(b.x - a.x) / 12);
    const y = up ? a.y : a.y + H, dy = up ? -lift : lift;
    const x1 = a.x + W / 2 + (up ? 12 : -12), x2 = b.x + W / 2 + (up ? -12 : 12);
    p = [x1, y, x1, y + dy, x2, y + dy, x2, y];
  } else {
    const down = b.y > a.y;
    const x1 = a.x + W / 2, y1 = down ? a.y + H : a.y, x2 = b.x + W / 2, y2 = down ? b.y : b.y + H;
    const c = (y2 - y1) / 2;
    p = [x1, y1, x1, y1 + c, x2, y2 - c, x2, y2];
  }
  const mid = { x: (p[0] + 3 * p[2] + 3 * p[4] + p[6]) / 8, y: (p[1] + 3 * p[3] + 3 * p[5] + p[7]) / 8 };
  return { d: `M ${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`, mid };
}

function ProcessGraph({ activities, transitions }: { activities: MiningActivity[]; transitions: MiningTransition[] }) {
  const pos = new Map(activities.map((a, i) => [a.id, { x: PAD + (i % COLS) * (W + GX), y: TOP + Math.floor(i / COLS) * (H + GY) }]));
  const rows = Math.ceil(activities.length / COLS);
  const width = PAD * 2 + Math.min(COLS, activities.length) * (W + GX) - GX;
  const height = TOP * 2 + rows * (H + GY) - GY;
  const maxW = Math.max(1, ...transitions.map((t) => t.weight));
  const showWeights = transitions.length <= 24;

  return (
    <svg className="ui-graph" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
         role="img" aria-label={`Process graph: ${plural(activities.length, "activity", "activities")}, ${plural(transitions.length, "transition")}`}>
      <defs>
        <marker id="pm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" className="ui-graph__arrow" />
        </marker>
      </defs>
      {transitions.map((t, i) => {
        const a = pos.get(t.from), b = pos.get(t.to);
        if (!a || !b) return null;
        const { d, mid } = edgePath(a, b);
        return (
          <g key={i}>
            <path className="ui-graph__edge" d={d} strokeWidth={1 + 3 * (t.weight / maxW)} markerEnd="url(#pm-arrow)" />
            {showWeights ? <text className="ui-graph__weight" x={mid.x} y={mid.y - 5} textAnchor="middle">{t.weight.toLocaleString()}</text> : null}
          </g>
        );
      })}
      {activities.map((a) => {
        const p = pos.get(a.id)!;
        const step = STEP[a.step_status] ?? STEP.green;
        return (
          <g key={a.id} transform={`translate(${p.x} ${p.y})`}>
            <title>{`${a.label}${a.tcode ? ` (${a.tcode})` : ""}: ${step.label}, ${plural(a.affected_records, "affected record")}`}</title>
            <rect className="ui-graph__node" width={W} height={H} rx="4" />
            <circle className="ui-graph__dot" data-status={step.status} cx="14" cy="19" r="4" />
            <text className="ui-graph__title" x="26" y="23">{a.label.length > 18 ? `${a.label.slice(0, 17)}…` : a.label}</text>
            <text className="ui-graph__sub" x="26" y="40">{plural(a.affected_records, "record")}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function ProcessMapPage() {
  const versionsQ = useQuery({ queryKey: ["versions.list", { limit: 10 }], queryFn: () => getVersions({ limit: 10 }) });
  const latest = useMemo(() => versionsQ.data?.versions.find(isComplete), [versionsQ.data]);
  const modules = useMemo(() => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []), [latest]);
  const [module, setModule] = useState<string | null>(null);
  const active = module ?? modules[0] ?? null;

  const graphQ = useQuery({
    queryKey: ["process.mining-graph", latest?.id, active],
    queryFn: () => getMiningGraph(latest!.id, active!),
    enabled: !!latest && !!active,
  });

  const activities = graphQ.data?.activities ?? [];
  const transitions = graphQ.data?.transitions ?? [];
  const variants = graphQ.data?.variants ?? [];
  const bottlenecks = activities.filter((a) => a.step_status !== "green").sort((a, b) => b.affected_records - a.affected_records);
  const affected = activities.reduce((s, a) => s + a.affected_records, 0);

  if (versionsQ.isLoading) {
    return <div className="ui-page"><PageHeader title="Process map" /><TableSkeleton rows={8} label="Loading process map" /></div>;
  }
  if (versionsQ.error) {
    return (
      <div className="ui-page">
        <PageHeader title="Process map" />
        <Banner tone="danger" title="Versions could not be read">{(versionsQ.error as Error).message}</Banner>
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="ui-page">
        <PageHeader title="Process map" />
        <EmptyState action={<Link className="ui-link" href="/sync">Open sync</Link>}>
          The map is mined from a completed analysis. Sync a system and run an analysis to see its process.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Process map"
        summary={`Mined from ${latest.label ?? "the latest complete version"}. ${bottlenecks.length ? `${plural(bottlenecks.length, "step")} in ${formatModuleName(active ?? "")} carry failing checks.` : "Every step passes its checks."}`}
      />

      {modules.length > 1 ? (
        <Tabs ariaLabel="Module" items={modules.map((m) => ({ id: m, label: formatModuleName(m) }))} value={active ?? ""} onValueChange={setModule} />
      ) : null}

      {graphQ.isLoading ? <TableSkeleton rows={8} label="Loading process graph" />
        : graphQ.error ? <Banner tone="danger" title="Process graph could not be read">{(graphQ.error as Error).message}</Banner>
        : (
          <>
            <MetricStrip label="Process figures">
              <Metric label="Activities" value={activities.length} />
              <Metric label="Transitions" value={transitions.length} />
              <Metric label="Variants" value={variants.length} />
              <Metric label="Affected records" value={affected.toLocaleString()} />
              <Metric label="Steps failing" value={bottlenecks.length} tone={bottlenecks.length ? "warning" : "default"} />
            </MetricStrip>

            <SectionCard title={formatModuleName(active ?? "")} meta={`${plural(activities.length, "activity", "activities")}, ${plural(transitions.length, "transition")}. Line weight is transition count.`} flush>
              {activities.length ? (
                <>
                  <div className="ui-graph-scroll"><ProcessGraph activities={activities} transitions={transitions} /></div>
                  <ul className="ui-legend" aria-label="Step state">
                    <li><StatusBadge status={STEP.green.status}>95% pass or better</StatusBadge></li>
                    <li><StatusBadge status={STEP.amber.status}>Medium finding, or 70 to 95% pass</StatusBadge></li>
                    <li><StatusBadge status={STEP.red.status}>Critical or high finding, or under 70% pass</StatusBadge></li>
                  </ul>
                </>
              ) : <EmptyState>No mined activities for this module. Its checks may not map to process steps yet.</EmptyState>}
            </SectionCard>

            <div className="ui-columns">
              <SectionCard title="Failing steps" meta="Ranked by affected records" flush>
                {bottlenecks.length ? (
                  <ol className="ui-ranked">
                    {bottlenecks.slice(0, 8).map((b) => (
                      <li key={b.id}>
                        <div className="ui-ranked__row">
                          <StatusBadge status={STEP[b.step_status].status}>{b.step_status === "red" ? "Blocking" : "Failing"}</StatusBadge>
                          <span className="ui-ranked__title">{b.label}</span>
                          <span className="ui-ranked__num">{plural(b.affected_records, "record")}</span>
                          <span className="ui-ranked__meta">
                            {b.tcode ? <><Mono>{b.tcode}</Mono>, </> : null}{plural(b.finding_count, "finding")}
                            {pct(b.avg_pass_rate) ? `, ${pct(b.avg_pass_rate)} pass rate` : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState>Every step passes its checks.</EmptyState>}
              </SectionCard>

              <SectionCard title="Variants" meta={`${plural(variants.length, "variant")} found`} flush>
                {variants.length ? (
                  <ul className="ui-ranked">
                    {variants.slice(0, 8).map((v) => (
                      <li key={v.id}>
                        <div className="ui-ranked__row">
                          <StatusBadge status={STEP[v.readiness]?.status ?? "idle"}>{READINESS[v.readiness] ?? v.readiness}</StatusBadge>
                          <span className="ui-ranked__title">{v.label}</span>
                          <span className="ui-ranked__num">{pct(v.coverage)} coverage</span>
                          <span className="ui-ranked__meta">{plural(v.activity_count, "step")}, quality {pct(v.quality)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState>No variants found for this module.</EmptyState>}
              </SectionCard>
            </div>
          </>
        )}
    </div>
  );
}
