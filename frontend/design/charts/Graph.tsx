"use client";

import { useMemo } from "react";
import { domainLabel, mColor, type DomainKey } from "../tokens";

export interface GraphNode {
  id: string;
  size: number;
  label?: string;
  /** Owning domain: the node fills with `mColor.dom[domain]`. Default is the first viz hue. */
  domain?: DomainKey;
  /** Cluster index: when set, the node fills from the ten-hue viz palette (index modulo 10) instead of its domain. */
  cluster?: number;
  /** Start or end pseudo node: drawn as an `--m-ink-3` ring with no fill. */
  kind?: "start" | "end";
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  /** Share of cases, 0 to 1. Drives width (`edgeWidth`) and colour band (`edgeBand`). */
  weight?: number;
  /** Median wait in the top decile of the run: drawn in `--m-critical`, target node gets the glow halo. */
  bottleneck?: boolean;
  /** Target earlier than source in rank: dashed 6 by 4 in `--m-high`. */
  rework?: boolean;
}

/** Edge stroke width in px: `1 + 4 * weight`, weight clamped to 0..1, so 1 to 5. A missing weight counts as 0.34. */
export function edgeWidth(weight: number | undefined): number {
  const w = Math.min(1, Math.max(0, weight ?? 0.34));
  // The frequent band carries its weight in the stroke (one pixel heavier), not in a hue: the accent is interaction only.
  return 1 + 4 * w + (edgeBand(w) === "high" ? 1 : 0);
}

export type EdgeBand = "low" | "mid" | "high";

/** Frequency band of an edge: under 0.25 low, 0.25 to 0.6 mid, above 0.6 high. */
export function edgeBand(weight: number | undefined): EdgeBand {
  const w = weight ?? 0.34;
  return w < 0.25 ? "low" : w <= 0.6 ? "mid" : "high";
}

const BAND_COLOR: Record<EdgeBand, string> = { low: "var(--m-line-strong)", mid: "var(--m-ink-3)", high: "var(--m-ink-2)" };

/** Stroke colour of an edge: critical for a bottleneck, high for rework, else its frequency band. */
export function edgeColor(e: Pick<GraphEdge, "weight" | "bottleneck" | "rework">): string {
  return e.bottleneck ? "var(--m-critical)" : e.rework ? "var(--m-high)" : BAND_COLOR[edgeBand(e.weight)];
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

/** Legend row for the process map: three frequency bands, bottleneck, rework and a chip per domain present. */
export function GraphLegend({ domains = [], bottleneck = false, rework = false }: { domains?: DomainKey[]; bottleneck?: boolean; rework?: boolean }) {
  const line = (color: string, label: string, dashed = false, width = 2) => (
    <li key={label} className="inline-flex items-center gap-2">
      <svg width={20} height={8} aria-hidden>
        <line x1={0} x2={20} y1={4} y2={4} stroke={color} strokeWidth={width} strokeDasharray={dashed ? "6 4" : undefined} />
      </svg>
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" style={{ listStyle: "none", margin: 0, padding: 0, fontSize: "var(--m-text-meta)", lineHeight: "var(--m-leading-meta)", color: "var(--m-ink-2)" }}>
      {line(BAND_COLOR.low, "Rare")}
      {line(BAND_COLOR.mid, "Common")}
      {line(BAND_COLOR.high, "Frequent", false, 3.5)}
      {bottleneck && line("var(--m-critical)", "Bottleneck")}
      {rework && line("var(--m-high)", "Rework", true)}
      {domains.map((d) => (
        <li key={d} className={`m-chip-domain m-chip-domain-${d}`}>
          <span className="m-chip-domain-swatch" aria-hidden />
          {domainLabel[d]}
        </li>
      ))}
    </ul>
  );
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
  /** Drill-selected node: gets the focus ring. */
  selectedId?: string;
  /** Pulse the bottleneck halo once on mount. Pass false on a filter change so it does not replay. Default true. */
  pulse?: boolean;
}) {
  const { nodes, edges, onNodeClick, width = 600, height = 400, title = "Duplicate cluster graph", weighted, selectedId, pulse = true } = props;
  const masterId = weighted ? undefined : props.masterId ?? [...nodes].sort((a, b) => b.size - a.size)[0]?.id;
  const maxSize = Math.max(1, ...nodes.map((n) => n.size));
  const node = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const radius = (id: string) =>
    weighted ? 4 + 10 * Math.sqrt((node.get(id)?.size ?? 0) / maxSize) : id === masterId ? 6 : 4;
  const points = useMemo(() => layoutGraph(nodes, edges, { width, height }), [nodes, edges, width, height]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const bottleneckTargets = useMemo(() => new Set(edges.filter((e) => e.bottleneck).map((e) => e.target)), [edges]);
  const directed = Boolean(weighted);
  const colors = useMemo(() => [...new Set(edges.map(edgeColor))], [edges]);
  const markerId = (c: string) => `m-arrow-${colors.indexOf(c)}`;

  return (
    <svg width={width} height={height} role="group" aria-label={`${title}, ${nodes.length} nodes, ${edges.length} links`}>
      {directed && (
        <defs>
          {colors.map((c) => (
            <marker key={c} id={markerId(c)} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
              <path d="M0 0 L6 3 L0 6 z" fill={c} />
            </marker>
          ))}
        </defs>
      )}
      {edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        const color = edgeColor(e);
        const w = edgeWidth(e.weight);
        // Stop the line at the target's rim so the arrowhead is visible.
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const inset = directed ? radius(e.target) + 2 : 0;
        const x2 = b.x - (dx / len) * inset;
        const y2 = b.y - (dy / len) * inset;
        const lx = (a.x + b.x) / 2;
        const ly = (a.y + b.y) / 2;
        return (
          <g key={`${e.source}-${e.target}-${i}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={w}
              strokeDasharray={e.rework ? "6 4" : undefined}
              markerEnd={directed ? `url(#${markerId(color)})` : undefined}
              data-edge-width={w}
            />
            {e.label && (
              <g>
                <rect x={lx - (e.label.length * 3.4 + 5)} y={ly - 9} width={e.label.length * 6.8 + 10} height={18} rx={9} fill="var(--m-sheet)" stroke="var(--m-line)" strokeWidth={1} />
                <text x={lx} y={ly + 4} fontSize={11} fontFamily="var(--m-font-mono)" fill="var(--m-ink-2)" textAnchor="middle">
                  {e.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {points.map((p) => {
        const n = node.get(p.id);
        const r = radius(p.id);
        const pseudo = n?.kind !== undefined;
        const fill = pseudo ? "none" : p.id === masterId ? mColor.ink : n?.cluster !== undefined ? mColor.viz[((n.cluster % mColor.viz.length) + mColor.viz.length) % mColor.viz.length] : n?.domain ? mColor.dom[n.domain] : mColor.viz[0];
        const inside = Boolean(weighted) && !pseudo && r > 18;
        const bottleneck = bottleneckTargets.has(p.id);
        return (
          <g
            key={p.id}
            className="m-graph-node"
            data-domain={n?.domain}
            data-cluster={n?.cluster}
            data-bottleneck={bottleneck || undefined}
            role={onNodeClick ? "button" : "img"}
            tabIndex={onNodeClick ? 0 : undefined}
            aria-label={`Node ${n?.label ?? p.id}`}
            onClick={() => onNodeClick?.(p.id)}
            onKeyDown={(e) => {
              if (onNodeClick && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onNodeClick(p.id);
              }
            }}
            style={{ cursor: onNodeClick ? "pointer" : "default" }}
          >
            {bottleneck && (
              <>
                <circle cx={p.x} cy={p.y} r={r + 3} fill="var(--m-glow-critical-fill)" />
                {pulse && <circle className="m-pulse-once" cx={p.x} cy={p.y} r={r + 3} style={{ ["--m-pulse-r0" as string]: `${r + 3}px`, ["--m-pulse-r1" as string]: `${r + 9}px` }} />}
              </>
            )}
            {selectedId === p.id && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke="var(--m-accent)" strokeWidth={2} />}
            <circle
              className="m-graph-node-dot"
              cx={p.x}
              cy={p.y}
              r={r}
              fill={fill}
              stroke={pseudo ? "var(--m-ink-3)" : "var(--m-sheet)"}
              strokeWidth={pseudo ? 2 : 1.5}
            />
            <text
              x={p.x}
              y={inside ? p.y + 4 : p.y - (weighted ? r + 6 : 10)}
              fontSize={11}
              fontFamily="var(--m-font-mono)"
              fill={inside ? "var(--m-hero-ink)" : "var(--m-ink-2)"}
              textAnchor="middle"
            >
              {weighted ? n?.label ?? p.id : p.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
