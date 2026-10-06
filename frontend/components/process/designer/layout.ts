import dagre from "@dagrejs/dagre";
import type { Diagram, DiagramNode } from "@/types/process-model";

export const SIZE: Record<DiagramNode["type"], { w: number; h: number }> = {
  task: { w: 220, h: 72 },
  exclusiveGateway: { w: 56, h: 56 },
  parallelGateway: { w: 56, h: 56 },
  startEvent: { w: 36, h: 36 },
  endEvent: { w: 36, h: 36 },
};

/** Left to right dagre layout. Returns top-left x,y per node id. */
export function layoutDiagram(d: Diagram): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 56, nodesep: 32, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of d.nodes) g.setNode(n.id, { width: SIZE[n.type].w, height: SIZE[n.type].h });
  for (const f of d.flows) if (g.hasNode(f.source) && g.hasNode(f.target)) g.setEdge(f.source, f.target);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of d.nodes) {
    const p = g.node(n.id);
    out[n.id] = { x: Math.round(p.x - SIZE[n.type].w / 2), y: Math.round(p.y - SIZE[n.type].h / 2) };
  }
  return out;
}
