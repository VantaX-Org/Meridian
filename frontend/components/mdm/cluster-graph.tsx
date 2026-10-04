"use client";

import type { ClusterEdge, ClusterGraph as ClusterGraphData } from "@/lib/api/merge-explain";

interface Props {
  graph: ClusterGraphData;
  selectedEdgeId?: string | null;
  onSelectEdge?: (edge: ClusterEdge) => void;
  size?: number;
}

const edgeColour = (e: ClusterEdge): string =>
  e.constraint === "do_not_match" || e.steward_decision === "reject"
    ? "var(--aurora-status-danger-500)"
    : e.linked
      ? "var(--aurora-accent-500)"
      : "var(--aurora-fg-muted)";

/**
 * Cluster members on a circle, survivor first. Solid edges link the cluster,
 * dashed edges are scored pairs below the auto-merge threshold, red edges are
 * do-not-match / rejected. Members that only join through a weak transitive
 * chain get an amber ring.
 */
export function ClusterGraph({ graph, selectedEdgeId, onSelectEdge, size = 320 }: Props) {
  // ponytail: circular layout; switch to a force layout if clusters routinely exceed ~40 members.
  const nodes = [...graph.nodes].sort((a, b) => Number(b.is_survivor) - Number(a.is_survivor));
  const c = size / 2;
  const r = nodes.length > 1 ? c - 36 : 0;
  const pos = new Map(
    nodes.map((n, i) => {
      const t = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      return [n.key, { x: c + r * Math.cos(t), y: c + r * Math.sin(t) }] as const;
    }),
  );
  const weakVia = new Set(graph.weak_chains.flatMap((w) => [w.a, w.b]));

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Match cluster of ${nodes.length} records with ${graph.weak_chains.length} weak chains`}
      style={{ width: "100%", maxWidth: size, height: "auto" }}
    >
      {graph.edges.map((e, i) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        const selected = e.id != null && e.id === selectedEdgeId;
        return (
          <g key={e.id ?? `${e.source}-${e.target}-${i}`}>
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={edgeColour(e)}
              strokeWidth={selected ? 3 : 1.5}
              strokeDasharray={e.linked ? undefined : "4 4"}
            />
            {/* wide transparent hit area for clicking an edge */}
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="transparent" strokeWidth={14}
              style={{ cursor: onSelectEdge && e.id ? "pointer" : "default" }}
              onClick={() => e.id && onSelectEdge?.(e)}
            >
              <title>
                {`${e.source} - ${e.target}: ${e.total == null ? "no score" : e.total.toFixed(3)}${e.constraint ? ` (${e.constraint})` : ""}`}
              </title>
            </line>
            {e.total != null && (
              <text
                x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle"
                fontSize={10} fill="var(--aurora-fg-secondary)" fontFamily="var(--aurora-font-mono)"
              >
                {e.total.toFixed(2)}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.key);
        if (!p) return null;
        return (
          <g key={n.key}>
            <circle
              cx={p.x} cy={p.y} r={n.is_survivor ? 14 : 11}
              fill="var(--aurora-elev-1-bg)"
              stroke={weakVia.has(n.key) ? "var(--aurora-status-warning-500)"
                : n.is_survivor ? "var(--aurora-accent-400)" : "var(--aurora-canvas-line)"}
              strokeWidth={n.is_survivor || weakVia.has(n.key) ? 2.5 : 1.5}
            />
            <text
              x={p.x} y={p.y + (n.is_survivor ? 28 : 25)} textAnchor="middle" fontSize={11}
              fill="var(--aurora-fg-primary)" fontFamily="var(--aurora-font-mono)"
            >
              {n.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
