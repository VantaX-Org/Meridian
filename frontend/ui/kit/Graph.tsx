export interface GraphNode {
  id: string;
  label: string;
  /** Hover text. Defaults to the label. */
  title?: string;
  /** Drawn heavier: the start node or the survivor. */
  emphasis?: boolean;
  /** Columns layout only: the column this node sits in, left to right. */
  column?: number;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Text on the line, such as a score. */
  label?: string;
  tone?: "good" | "bad";
  dashed?: boolean;
  /** Drawn heavier, for the picked edge. */
  active?: boolean;
}

const COL = { w: 150, h: 30, gx: 60, gy: 12 };
const RING = { w: 480, h: 360 };

/**
 * A small node and edge diagram. `columns` puts nodes in vertical columns by `column` (lineage, edges run left to right).
 * `circle` spaces nodes round a ring (match clusters). Give `onPick` to make edges clickable and keyboard reachable.
 */
export function Graph({ nodes, edges, layout, label, onPick }: { nodes: GraphNode[]; edges: GraphEdge[]; layout: "columns" | "circle"; label: string; onPick?: (e: GraphEdge) => void }) {
  const pos = new Map<string, { x: number; y: number }>();
  let width: number;
  let height: number;
  if (layout === "columns") {
    const cols = [...new Set(nodes.map((n) => n.column ?? 0))].sort((a, b) => a - b);
    let rows = 1;
    cols.forEach((c, ci) => {
      const col = nodes.filter((n) => (n.column ?? 0) === c);
      rows = Math.max(rows, col.length);
      col.forEach((n, ri) => pos.set(n.id, { x: ci * (COL.w + COL.gx), y: ri * (COL.h + COL.gy) }));
    });
    width = Math.max(cols.length * (COL.w + COL.gx) - COL.gx, COL.w);
    height = Math.max(rows * (COL.h + COL.gy), COL.h);
  } else {
    width = RING.w;
    height = RING.h;
    const r = Math.min(width, height) / 2 - 56;
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
      pos.set(n.id, { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a) });
    });
  }
  const ends = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    layout === "columns" ? { x1: a.x + COL.w, y1: a.y + COL.h / 2, x2: b.x, y2: b.y + COL.h / 2 } : { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  return (
    <svg className="mx-graph" width="100%" height={layout === "circle" ? height : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {edges.map((e) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        const l = ends(a, b);
        const stroke = e.tone === "bad" ? "var(--mx-bad)" : e.tone === "good" ? "var(--mx-good)" : "var(--mx-border-strong)";
        const line = <line {...l} stroke={stroke} strokeWidth={e.active ? 4 : 2} strokeDasharray={e.dashed ? "4 4" : undefined} />;
        const text = e.label ? <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2} fill="var(--mx-ink-2)" fontSize={11} textAnchor="middle">{e.label}</text> : null;
        return onPick ? (
          <g key={e.id} role="button" tabIndex={0} aria-label={e.label ?? `${e.source} ${e.target}`} onClick={() => onPick(e)} onKeyDown={(k) => { if (k.key === "Enter") onPick(e); }}>{line}{text}</g>
        ) : (
          <g key={e.id}>{line}{text}</g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        return layout === "columns" ? (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`}>
            <title>{n.title ?? n.label}</title>
            <rect width={COL.w} height={COL.h} rx={6} fill="none" stroke="var(--mx-ink-3)" strokeWidth={n.emphasis ? 2 : 1} />
            <text x={8} y={COL.h / 2 + 4} fontSize={11} fill="var(--mx-ink-2)">{n.label.length > 22 ? `${n.label.slice(0, 21)}...` : n.label}</text>
          </g>
        ) : (
          <g key={n.id}>
            <title>{n.title ?? n.label}</title>
            <circle cx={p.x} cy={p.y} r={n.emphasis ? 12 : 9} fill={n.emphasis ? "var(--mx-accent)" : "var(--mx-surface-2)"} stroke="var(--mx-ink-3)" strokeWidth={1.5} />
            <text x={p.x} y={p.y + (p.y < height / 2 ? -18 : 26)} fill="var(--mx-ink)" fontSize={11} textAnchor="middle">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
