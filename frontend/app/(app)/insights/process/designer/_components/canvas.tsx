"use client";

import "@xyflow/react/dist/style.css";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/design";
import type { DomainKey } from "@/design/tokens";
import type { ActivityOverlay, L4, NodeType } from "@/types/process-model";
import { layoutDiagram, SIZE } from "./layout";
import { nodeTypes, type MarkData, type TaskData } from "./nodes";

export interface CanvasProps {
  l4: L4;
  /** Owning domain of the L1 this diagram belongs to: tasks carry its edge. */
  domain?: DomainKey;
  overlay: Record<string, ActivityOverlay> | null;
  /** Selected node, activity or flow id (the `attr` URL param). */
  selected: string | null;
  editable: boolean;
  onBlocked: () => void;
  /** False when the user lacks `analyse` (wave 16): mutating controls are not rendered. */
  canDesign?: boolean;
  onSelect: (id: string | null) => void;
  onMove: (nodeId: string, x: number, y: number) => void;
  onConnect: (source: string, target: string) => void;
  onDeleteNode: (nodeId: string, withActivity: boolean) => void;
  onDeleteFlow: (flowId: string) => void;
  onAdd: (type: NodeType) => void;
  onLayout: () => void;
}

/** React Flow nodes for a diagram. Sizes come from SIZE so they match the dagre slot and the CSS. */
export function buildNodes(
  l4: L4, overlay: Record<string, ActivityOverlay> | null, selected: string | null,
  drag: Record<string, { x: number; y: number }>, auto: Record<string, { x: number; y: number }>,
  domain?: DomainKey,
): Node[] {
  const acts = new Map(l4.activities.map((a) => [a.id, a]));
  return l4.diagram.nodes.map((n) => {
    const size = { width: SIZE[n.type].w, height: SIZE[n.type].h };
    const act = n.activity_id ? acts.get(n.activity_id) : undefined;
    const pos = drag[n.id] ?? (n.x != null && n.y != null ? { x: n.x, y: n.y } : auto[n.id]);
    const isSel = selected === n.id || (!!n.activity_id && selected === n.activity_id);
    if (n.type === "task") {
      const data: TaskData = {
        name: act?.name ?? n.label ?? "Activity", tcode: act?.tcode ?? null, fields: act?.fields.length ?? 0,
        rules: act?.check_ids.length ?? 0, status: act ? overlay?.[act.id]?.dq_status : undefined,
        failing: act ? overlay?.[act.id]?.finding_count : undefined, affected: act ? overlay?.[act.id]?.affected_count : undefined,
        evidence: n.evidence ?? act?.evidence, selected: isSel, domain,
      };
      return { id: n.id, type: "bpmnTask", position: pos, data, ...size };
    }
    const data: MarkData = { label: n.label ?? "", end: n.type === "endEvent", parallel: n.type === "parallelGateway", selected: isSel };
    const gate = n.type === "exclusiveGateway" || n.type === "parallelGateway";
    return { id: n.id, type: gate ? "bpmnGateway" : "bpmnEvent", position: pos, data, ...size };
  });
}

function CanvasInner(p: CanvasProps) {
  const { l4, overlay, selected } = p;
  const [connectMode, setConnectMode] = useState(false);
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const auto = useMemo(() => layoutDiagram(l4.diagram), [l4.diagram]);

  const nodes = useMemo<Node[]>(() => buildNodes(l4, overlay, selected, drag, auto, p.domain), [l4, overlay, selected, drag, auto, p.domain]);

  const edges = useMemo<Edge[]>(() => l4.diagram.flows.map((f) => ({
    id: f.id, source: f.source, target: f.target, type: "smoothstep", label: f.label ?? f.condition ?? undefined,
    selected: selected === f.id,
    style: { stroke: selected === f.id ? "var(--m-accent)" : "var(--m-line)", strokeWidth: 1.25 },
    ariaLabel: `Flow ${f.label ?? ""}`.trim(),
  })), [l4.diagram.flows, selected]);

  const onNodesChange = (changes: NodeChange[]) => {
    const moved = applyNodeChanges(changes, nodes);
    for (const c of changes) {
      if (c.type !== "position" || !c.position) continue;
      const at = moved.find((n) => n.id === c.id)?.position ?? c.position;
      if (c.dragging) setDrag((d) => ({ ...d, [c.id]: at }));
      else {
        setDrag((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== c.id)));
        p.onMove(c.id, at.x, at.y);
      }
    }
  };

  const guard = (fn: () => void) => () => (p.editable ? fn() : p.onBlocked());
  const selNode = l4.diagram.nodes.find((n) => n.id === selected || (!!n.activity_id && n.activity_id === selected));
  const selFlow = l4.diagram.flows.find((f) => f.id === selected);

  const remove = () => {
    if (!p.editable) return p.onBlocked();
    if (selFlow) p.onDeleteFlow(selFlow.id);
    else if (selNode?.type === "task") setAskDelete(selNode.id);
    else if (selNode) p.onDeleteNode(selNode.id, false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement).closest("input,textarea,select")) {
      e.preventDefault();
      remove();
    }
  };

  return (
    <div className="m-designer__canvas-wrap" onKeyDown={onKeyDown}>
      {p.canDesign !== false ? <div className="flex flex-wrap items-center gap-2 mb-2" role="toolbar" aria-label="Diagram tools">
        <Button variant="secondary" onClick={guard(() => p.onAdd("task"))}><Plus size={14} aria-hidden /> Add activity</Button>
        <Button variant="secondary" onClick={guard(() => p.onAdd("exclusiveGateway"))}>Add gateway</Button>
        <Button variant="secondary" onClick={guard(() => p.onAdd("endEvent"))}>Add event</Button>
        <Button variant="secondary" onClick={guard(p.onLayout)}><LayoutGrid size={14} aria-hidden /> Auto-layout</Button>
        <Button variant={connectMode ? "primary" : "secondary"} aria-pressed={connectMode}
          onClick={() => (p.editable ? setConnectMode((v) => !v) : p.onBlocked())}>Connect mode</Button>
        <IconButton aria-label="Delete selected" disabled={!selNode && !selFlow} onClick={remove}><Trash2 size={16} aria-hidden /></IconButton>
        {askDelete ? (
          <span className="inline-flex items-center gap-2 m-text-body m-ink-2" role="alertdialog" aria-label="Delete activity">
            Also delete the activity?
            <Button variant="secondary" onClick={() => { p.onDeleteNode(askDelete, true); setAskDelete(null); }}>Delete both</Button>
            <Button variant="ghost" onClick={() => { p.onDeleteNode(askDelete, false); setAskDelete(null); }}>Step only</Button>
            <Button variant="ghost" onClick={() => setAskDelete(null)}>Keep both</Button>
          </span>
        ) : null}
      </div> : null}
      <div className="m-process-graph m-designer__canvas" data-connect={connectMode || undefined}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => p.onSelect(l4.diagram.nodes.find((x) => x.id === n.id)?.activity_id ?? n.id)}
          onEdgeClick={(_, e) => p.onSelect(e.id)}
          onPaneClick={() => p.onSelect(null)}
          onConnect={(c) => { if (c.source && c.target) p.onConnect(c.source, c.target); }}
          nodesDraggable={p.editable && !connectMode}
          nodesConnectable={p.editable && connectMode}
          elementsSelectable
          deleteKeyCode={null}
          fitView fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--m-line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function DesignerCanvas(p: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
