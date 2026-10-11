"use client";

import { useMemo } from "react";

export interface GraphNode {
  id: string;
  size: number;
  label?: string;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  weight?: number;
}

interface Point {
  id: string;
  x: number;
  y: number;
}

/**
 * Fruchterman-Reingold force-directed layout: nodes repel each other
 * (inverse-square), connected nodes attract (spring toward an ideal edge
 * length), positions are clamped to [0, width] x [0, height]. Deterministic:
 * node order fixes the initial circular placement, so the same input always
 * produces the same output (needed for the vitest determinism check below
 * and so screenshots in Playwright don't flake).
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts?: { width?: number; height?: number; iterations?: number },
): Point[] {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 400;
  const iterations = opts?.iterations ?? 200;
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1));

  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    pos.set(n.id, {
      x: width / 2 + (width / 3) * Math.cos(angle),
      y: height / 2 + (height / 3) * Math.sin(angle),
    });
  });

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { x: number; y: number }>(nodes.map((n) => [n.id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id;
        const b = nodes[j].id;
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        disp.get(a)!.x += dx;
        disp.get(a)!.y += dy;
        disp.get(b)!.x -= dx;
        disp.get(b)!.y -= dy;
      }
    }

    for (const e of edges) {
      const pa = pos.get(e.source);
      const pb = pos.get(e.target);
      if (!pa || !pb) continue;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      disp.get(e.source)!.x -= dx;
      disp.get(e.source)!.y -= dy;
      disp.get(e.target)!.x += dx;
      disp.get(e.target)!.y += dy;
    }

    const temp = width * (1 - iter / iterations) * 0.1;
    for (const n of nodes) {
      const d = disp.get(n.id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const p = pos.get(n.id)!;
      p.x = Math.min(width, Math.max(0, p.x + (d.x / dist) * Math.min(dist, temp)));
      p.y = Math.min(height, Math.max(0, p.y + (d.y / dist) * Math.min(dist, temp)));
    }
  }

  return nodes.map((n) => ({ id: n.id, x: pos.get(n.id)!.x, y: pos.get(n.id)!.y }));
}

export function Graph(props: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (id: string) => void;
  /** Id of the master (golden) node, drawn larger in `--m-ink`; defaults to the largest cluster node. */
  masterId?: string;
  width?: number;
  height?: number;
  /** Accessible name of the chart; defaults to the duplicate-cluster wording. */
  title?: string;
  /** Radius scales with `size` and nodes show `label`: the process flow view (node size is cases). */
  weighted?: boolean;
}) {
  const { nodes, edges, onNodeClick, width = 600, height = 400, title = "Duplicate cluster graph", weighted } = props;
  const masterId = weighted ? undefined : props.masterId ?? [...nodes].sort((a, b) => b.size - a.size)[0]?.id;
  const maxSize = Math.max(1, ...nodes.map((n) => n.size));
  const node = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const radius = (id: string) =>
    weighted ? 4 + 10 * Math.sqrt((node.get(id)?.size ?? 0) / maxSize) : id === masterId ? 6 : 4;
  const points = useMemo(() => layoutGraph(nodes, edges, { width, height }), [nodes, edges, width, height]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);

  return (
    <svg width={width} height={height} role="group" aria-label={`${title}, ${nodes.length} nodes, ${edges.length} links`}>
      {edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        return (
          <g key={`${e.source}-${e.target}-${i}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--m-line-strong)" strokeWidth={Math.min(3, Math.max(1, Math.round((e.weight ?? 0.34) * 3)))} />
            {e.label && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={11} fontFamily="var(--m-font-mono)" fill="var(--m-ink-3)">
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {points.map((p) => (
        <g
          key={p.id}
          className="m-graph-node"
          role={onNodeClick ? "button" : "img"}
          tabIndex={onNodeClick ? 0 : undefined}
          aria-label={`Node ${node.get(p.id)?.label ?? p.id}`}
          onClick={() => onNodeClick?.(p.id)}
          onKeyDown={(e) => {
            if (onNodeClick && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onNodeClick(p.id);
            }
          }}
          style={{ cursor: onNodeClick ? "pointer" : "default" }}
        >
          <circle cx={p.x} cy={p.y} r={radius(p.id)} fill={p.id === masterId ? "var(--m-ink)" : "var(--m-viz-1)"} />
          <text x={p.x} y={p.y - (weighted ? radius(p.id) + 6 : 10)} fontSize={11} fontFamily="var(--m-font-mono)" fill="var(--m-ink-2)" textAnchor="middle">
            {weighted ? node.get(p.id)?.label ?? p.id : p.id}
          </text>
        </g>
      ))}
    </svg>
  );
}
