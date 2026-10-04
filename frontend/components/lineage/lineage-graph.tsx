"use client";

import { useMemo } from "react";
import type { LineageGraph, LineageNode, LineageNodeType } from "@/lib/api/lineage";

/** Left-to-right causal order: every edge in the model points rightwards. */
export const LINEAGE_COLUMNS: { type: LineageNodeType; label: string }[] = [
  { type: "config", label: "Config (SPRO)" },
  { type: "check", label: "Rule" },
  { type: "field", label: "Field" },
  { type: "table", label: "Table" },
  { type: "object", label: "Object" },
  { type: "step", label: "L4/L5 step" },
  { type: "process", label: "L1/L2 process" },
  { type: "feature", label: "SAP feature" },
  { type: "kpi", label: "KPI" },
];

const COL_W = 168;
const NODE_W = 148;
const NODE_H = 26;
const ROW_H = 32;
const HEAD_H = 28;
const MAX_PER_COL = 30;

interface Placed {
  node: LineageNode;
  x: number;
  y: number;
}

export function LineageGraphView({
  data,
  selected,
  onSelect,
}: {
  data: LineageGraph;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const layout = useMemo(() => {
    const onPath = new Set(data.paths_to_kpis.flat());
    const cols = LINEAGE_COLUMNS.map((c) => ({
      ...c,
      nodes: data.nodes
        .filter((n) => n.type === c.type)
        .sort((a, b) => Number(onPath.has(b.id)) - Number(onPath.has(a.id)) || Math.abs(a.depth) - Math.abs(b.depth) || a.id.localeCompare(b.id)),
    })).filter((c) => c.nodes.length > 0);
    const placed = new Map<string, Placed>();
    const hidden: Record<string, number> = {};
    cols.forEach((c, ci) => {
      c.nodes.slice(0, MAX_PER_COL).forEach((n, ri) => {
        placed.set(n.id, { node: n, x: ci * COL_W + 8, y: HEAD_H + ri * ROW_H });
      });
      hidden[c.type] = Math.max(0, c.nodes.length - MAX_PER_COL);
    });
    const rows = Math.max(1, ...cols.map((c) => Math.min(c.nodes.length, MAX_PER_COL) + (hidden[c.type] ? 1 : 0)));
    const pathEdges = new Set<string>();
    for (const p of data.paths_to_kpis) for (let i = 1; i < p.length; i++) pathEdges.add(`${p[i - 1]}>${p[i]}`);
    return {
      cols,
      placed,
      hidden,
      pathEdges,
      onPath,
      width: cols.length * COL_W,
      height: HEAD_H + rows * ROW_H + 8,
    };
  }, [data]);

  const { cols, placed, hidden, pathEdges, onPath, width, height } = layout;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Lineage of ${data.start}`}
        style={{ display: "block", font: "500 11px/1 Inter, system-ui, sans-serif" }}
      >
        {cols.map((c, ci) => (
          <text key={c.type} x={ci * COL_W + 8} y={14} fill="var(--mn-ink-400)" style={{ font: "600 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>
            {c.label.toUpperCase()} · {c.nodes.length}
          </text>
        ))}
        {data.edges.map((e) => {
          const s = placed.get(e.source);
          const t = placed.get(e.target);
          if (!s || !t) return null;
          const hot = pathEdges.has(`${e.source}>${e.target}`);
          const x1 = s.x + NODE_W;
          const y1 = s.y + NODE_H / 2;
          const x2 = t.x;
          const y2 = t.y + NODE_H / 2;
          // Same-column edges (e.g. table -> table joins) bend out to the right.
          const d = x2 > x1
            ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
            : `M${x1},${y1} C${x1 + 16},${y1} ${x1 + 16},${y2} ${t.x + NODE_W},${y2}`;
          return (
            <path
              key={`${e.source}>${e.target}`}
              d={d}
              fill="none"
              stroke={e.impact_type === "full_block" ? "var(--mn-neg)" : hot ? "var(--mn-primary)" : "var(--mn-ink-300)"}
              strokeOpacity={hot || e.impact_type ? 0.9 : 0.35}
              strokeWidth={hot ? 1.6 : 1}
            >
              <title>{`${e.rel} (${e.origin})`}</title>
            </path>
          );
        })}
        {[...placed.values()].map(({ node, x, y }) => {
          const isStart = node.id === data.start;
          const isSel = node.id === selected;
          return (
            <g
              key={node.id}
              transform={`translate(${x},${y})`}
              style={{ cursor: onSelect ? "pointer" : "default" }}
              onClick={() => onSelect?.(node.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") onSelect?.(node.id);
              }}
              tabIndex={onSelect ? 0 : undefined}
              role={onSelect ? "button" : undefined}
              aria-label={node.label}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={5}
                fill={isStart ? "var(--mn-primary-50)" : "var(--mn-card)"}
                stroke={isSel || isStart ? "var(--mn-primary)" : onPath.has(node.id) ? "var(--mn-ink-400)" : "var(--mn-line)"}
                strokeWidth={isSel ? 2 : 1}
              />
              <text x={8} y={NODE_H / 2 + 4} fill="var(--mn-ink-900)">
                {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
              </text>
              <title>{`${node.id}\n${node.label}\n${node.depth < 0 ? `${-node.depth} hop(s) upstream` : node.depth > 0 ? `${node.depth} hop(s) downstream` : "start"}`}</title>
            </g>
          );
        })}
        {cols.map((c, ci) =>
          hidden[c.type] ? (
            <text key={`more-${c.type}`} x={ci * COL_W + 8} y={HEAD_H + MAX_PER_COL * ROW_H + 14} fill="var(--mn-ink-400)">
              +{hidden[c.type]} more
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
