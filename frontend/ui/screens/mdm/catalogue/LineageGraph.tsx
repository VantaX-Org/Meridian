"use client";

import type { LineageGraph as Graph } from "@/lib/api/v2/lineage";
import { t } from "@/lib/v2/i18n";

const W = 150, H = 30, GX = 60, GY = 12;

/** Local SVG graph: one column per depth (upstream left, start centre, downstream right), edges as straight lines. Kit request: shared graph component. */
export function LineageGraph({ graph }: { graph: Graph }) {
  const depths = [...new Set(graph.nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  let maxRows = 1;
  depths.forEach((d, ci) => {
    const col = graph.nodes.filter((n) => n.depth === d);
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, ri) => pos.set(n.id, { x: ci * (W + GX), y: ri * (H + GY) }));
  });
  const width = depths.length * (W + GX) - GX, height = maxRows * (H + GY);
  return (
    <svg role="img" aria-label={t("Lineage graph")} viewBox={`0 0 ${Math.max(width, W)} ${Math.max(height, H)}`} width="100%" className="mx-muted">
      {graph.edges.map((e, i) => {
        const a = pos.get(e.source), b = pos.get(e.target);
        return a && b ? <line key={i} x1={a.x + W} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2} stroke="currentColor" strokeOpacity={0.45} /> : null;
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`}>
            <title>{n.description ?? n.label}</title>
            <rect width={W} height={H} rx={6} fill="none" stroke="currentColor" strokeWidth={n.id === graph.start ? 2 : 1} />
            <text x={8} y={H / 2 + 4} fontSize={11} fill="currentColor">{n.label.length > 22 ? `${n.label.slice(0, 21)}...` : n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
