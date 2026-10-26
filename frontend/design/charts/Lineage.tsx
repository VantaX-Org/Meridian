"use client";

// frontend/design/charts/Lineage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { mColor } from "../tokens";
import { ChartLegend } from "./Legend";

export type LineageChartType = "config" | "table" | "field" | "check" | "object" | "step" | "process" | "feature" | "kpi";

export interface LineageChartNode {
  id: string;
  type: LineageChartType;
  label: string;
  /** Marks the node with the critical swatch: a failing rule reaches it. */
  atRisk?: boolean;
}

export interface LineageChartEdge {
  source: string;
  target: string;
  impact?: "cosmetic" | "degraded" | "full_block" | null;
}

/** Left to right: where data is configured and stored, through the rules that guard it, to the outcomes it drives. */
const ORDER: LineageChartType[] = ["config", "table", "field", "check", "object", "step", "process", "feature", "kpi"];
const TYPE_LABEL: Record<LineageChartType, string> = {
  config: "Configuration", table: "Tables", field: "Fields", check: "Rules", object: "Objects",
  step: "Steps", process: "Processes", feature: "Features", kpi: "KPIs",
};
const TYPE_COLOR: Record<LineageChartType, string> = {
  config: mColor.viz[7], table: mColor.viz[0], field: mColor.viz[8], check: mColor.viz[2], object: mColor.viz[3],
  step: mColor.viz[4], process: mColor.viz[1], feature: mColor.viz[9], kpi: mColor.viz[5],
};
const EDGE_COLOR = { full_block: "var(--m-critical)", degraded: "var(--m-high)", cosmetic: "var(--m-line-strong)" } as const;
/** The non-colour cue for impact: a blocking link is long-dashed, a degrading one dotted, any other link solid. */
const EDGE_DASH = { full_block: "6 3", degraded: "2 3", cosmetic: undefined } as const;
/** Read and hovered with an at-risk node's label. */
export const AT_RISK_NOTE = "reached by a failing rule";

const MIN_COL_W = 128;
const ROW_H = 22;
const HEAD_H = 28;
const PAD = 8;
const DOT = 8;

function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Layered lineage: one column per node type present, in data-flow order, nodes
 * stacked by label. Links are plain hairlines; a link that blocks or degrades
 * its target takes the defect colour. Hovering or selecting a node keeps its
 * neighbourhood and fades the rest. Scales to the card width.
 */
export function LineageChart({
  nodes, edges, focusId, selectedId, onNodeClick,
}: {
  nodes: LineageChartNode[];
  edges: LineageChartEdge[];
  /** The node the trace started from. */
  focusId?: string;
  selectedId?: string | null;
  onNodeClick?: (id: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pos, cols, width, height, adjacency, COL_W } = useMemo(() => {
    const present = ORDER.filter((t) => nodes.some((n) => n.type === t));
    const COL_W = Math.max(MIN_COL_W, Math.floor(boxW / Math.max(1, present.length)));
    const colOf = new Map(present.map((t, i) => [t, i]));
    const stacks = new Map<LineageChartType, LineageChartNode[]>();
    for (const n of nodes) stacks.set(n.type, [...(stacks.get(n.type) ?? []), n]);
    const pos = new Map<string, { x: number; y: number; node: LineageChartNode }>();
    let rows = 0;
    for (const [t, list] of stacks) {
      list.sort((a, b) => Number(b.atRisk ?? false) - Number(a.atRisk ?? false) || a.label.localeCompare(b.label));
      list.forEach((n, i) => pos.set(n.id, { x: colOf.get(t)! * COL_W, y: HEAD_H + i * ROW_H, node: n }));
      rows = Math.max(rows, list.length);
    }
    const adjacency = new Map<string, Set<string>>();
    for (const e of edges) {
      adjacency.set(e.source, (adjacency.get(e.source) ?? new Set()).add(e.target));
      adjacency.set(e.target, (adjacency.get(e.target) ?? new Set()).add(e.source));
    }
    // ponytail: naive stacking; a column past ~40 rows gets tall. Narrow the depth before adding sugiyama ordering.
    return { pos, cols: present, width: Math.max(1, present.length) * COL_W, height: HEAD_H + rows * ROW_H + PAD, adjacency, COL_W };
  }, [nodes, edges, boxW]);

  if (!nodes.length) return null;
  const active = hover ?? selectedId ?? null;
  const near = active ? adjacency.get(active) ?? new Set<string>() : null;
  const dimNode = (id: string) => (near ? !(id === active || near.has(id)) : false);
  const dimEdge = (e: LineageChartEdge) => (near ? !(e.source === active || e.target === active) : false);
  const maxChars = Math.floor((COL_W - DOT - PAD * 4) / 6.2);

  return (
    <figure ref={box} className="m-0 flex flex-col gap-2">
      <ChartLegend items={cols.map((t) => ({ key: t, name: TYPE_LABEL[t], color: TYPE_COLOR[t] }))} />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Lineage trace" style={{ display: "block", maxWidth: "100%", height: "auto", overflow: "visible" }}>
        {cols.map((t, i) => (
          <text key={t} x={i * COL_W + PAD} y={14} fill="var(--m-ink-3)" style={{ fontSize: "var(--m-text-meta)" }}>{TYPE_LABEL[t]}</text>
        ))}
        <g fill="none" strokeWidth={1}>
          {edges.map((e, i) => {
            const a = pos.get(e.source); const b = pos.get(e.target);
            if (!a || !b) return null;
            const x1 = a.x + COL_W - PAD * 2, y1 = a.y + ROW_H / 2, x2 = b.x + PAD, y2 = b.y + ROW_H / 2;
            const dx = Math.max(24, Math.abs(x2 - x1) / 2);
            return (
              <path key={i} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                stroke={e.impact ? EDGE_COLOR[e.impact] : "var(--m-line-strong)"}
                strokeOpacity={dimEdge(e) ? 0.12 : e.impact ? 0.9 : 0.6} strokeWidth={e.impact === "full_block" ? 1.5 : 1}
                strokeDasharray={e.impact ? EDGE_DASH[e.impact] : undefined} data-impact={e.impact ?? undefined} />
            );
          })}
        </g>
        {[...pos.values()].map(({ x, y, node: n }) => {
          const sel = n.id === selectedId;
          return (
            <g key={n.id} transform={`translate(${x + PAD},${y})`} className="m-graph-node" role={onNodeClick ? "button" : undefined} tabIndex={onNodeClick ? 0 : undefined}
              style={{ cursor: onNodeClick ? "pointer" : "default", opacity: dimNode(n.id) ? 0.3 : 1 }}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onClick={() => onNodeClick?.(n.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onNodeClick?.(n.id); } }}>
              <title>{n.atRisk ? `${n.label}, ${AT_RISK_NOTE}` : n.label}</title>
              {/* At risk also takes a dashed critical outline, so it never rests on the red square's colour alone. */}
              <rect x={-PAD / 2} y={2} width={COL_W - PAD * 2} height={ROW_H - 4} fill={sel || n.id === focusId ? "var(--m-accent-soft)" : "transparent"}
                stroke={n.atRisk ? "var(--m-critical)" : "none"} strokeDasharray={n.atRisk ? "3 2" : undefined} data-at-risk={n.atRisk ? "" : undefined} />
              <rect className="m-graph-node-dot" x={0} y={(ROW_H - DOT) / 2} width={DOT} height={DOT} fill={n.atRisk ? "var(--m-critical)" : TYPE_COLOR[n.type]}
                stroke={n.id === focusId ? "var(--m-accent)" : "none"} strokeWidth={2} />
              <text x={DOT + PAD} y={ROW_H / 2 + 4} fill="var(--m-ink)" style={{ fontSize: "var(--m-text-body)", fontWeight: n.id === focusId ? 600 : 400 }}>
                {clip(n.label, maxChars)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
