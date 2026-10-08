"use client";

import { useMemo } from "react";

export interface GraphNode {
  id: string;
  size: number;
  label?: string;
}

export interface GraphEdge {
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
  width?: number;
  height?: number;
}) {
  const { nodes, edges, onNodeClick, width = 600, height = 400 } = props;
  const points = useMemo(() => layoutGraph(nodes, edges, { width, height }), [nodes, edges, width, height]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const sizeById = useMemo(() => new Map(nodes.map((n) => [n.id, n.size])), [nodes]);

  return (
    <svg width={width} height={height} role="img" aria-label="Duplicate cluster graph">
      {edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        return (
          <g key={`${e.source}-${e.target}-${i}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--m-line)" />
            {e.label && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={10}>
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {points.map((p) => (
        <g key={p.id} onClick={() => onNodeClick?.(p.id)} style={{ cursor: onNodeClick ? "pointer" : "default" }}>
          <circle cx={p.x} cy={p.y} r={4 + Math.sqrt(sizeById.get(p.id) ?? 1)} fill="var(--aurora-accent-500)" />
          <text x={p.x} y={p.y - 8} fontSize={10} textAnchor="middle">
            {p.id}
          </text>
        </g>
      ))}
    </svg>
  );
}
