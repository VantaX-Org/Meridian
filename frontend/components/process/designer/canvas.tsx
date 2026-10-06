"use client";

import "@xyflow/react/dist/style.css";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui-core";
import type { ActivityOverlay, L4, NodeType } from "@/types/process-model";
import { layoutDiagram } from "./layout";
import { nodeTypes, type MarkData, type TaskData } from "./nodes";

export interface CanvasProps {
  l4: L4;
  overlay: Record<string, ActivityOverlay> | null;
  /** Selected node, activity or flow id (the `attr` URL param). */
  selected: string | null;
  editable: boolean;
  onBlocked: () => void;
  onSelect: (id: string | null) => void;
  onMove: (nodeId: string, x: number, y: number) => void;
  onConnect: (source: string, target: string) => void;
  onDeleteNode: (nodeId: string, withActivity: boolean) => void;
  onDeleteFlow: (flowId: string) => void;
  onAdd: (type: NodeType) => void;
  onLayout: () => void;
}

function CanvasInner(p: CanvasProps) {
  const { l4, overlay, selected } = p;
  const [connectMode, setConnectMode] = useState(false);
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const auto = useMemo(() => layoutDiagram(l4.diagram), [l4.diagram]);
  const acts = useMemo(() => new Map(l4.activities.map((a) => [a.id, a])), [l4.activities]);

  const nodes = useMemo<Node[]>(() => l4.diagram.nodes.map((n) => {
    const act = n.activity_id ? acts.get(n.activity_id) : undefined;
    const pos = drag[n.id] ?? (n.x != null && n.y != null ? { x: n.x, y: n.y } : auto[n.id]);
    const isSel = selected === n.id || (!!n.activity_id && selected === n.activity_id);
    if (n.type === "task") {
      const data: TaskData = {
        name: act?.name ?? n.label ?? "Activity", tcode: act?.tcode ?? null, fields: act?.fields.length ?? 0,
        rules: act?.check_ids.length ?? 0, status: act ? overlay?.[act.id]?.dq_status : undefined,
        evidence: n.evidence ?? act?.evidence, selected: isSel,
      };
      return { id: n.id, type: "bpmnTask", position: pos, data, width: 220, height: 72 };
    }
    const data: MarkData = { label: n.label ?? "", end: n.type === "endEvent", parallel: n.type === "parallelGateway", selected: isSel };
    const gate = n.type === "exclusiveGateway" || n.type === "parallelGateway";
    return { id: n.id, type: gate ? "bpmnGateway" : "bpmnEvent", position: pos, data, width: gate ? 56 : 36, height: gate ? 56 : 36 };
  }), [l4.diagram.nodes, acts, drag, auto, selected, overlay]);

  const edges = useMemo<Edge[]>(() => l4.diagram.flows.map((f) => ({
    id: f.id, source: f.source, target: f.target, type: "smoothstep", label: f.label ?? f.condition ?? undefined,
    selected: selected === f.id,
    style: { stroke: selected === f.id ? "var(--aurora-accent-400)" : "var(--aurora-canvas-line)", strokeWidth: 1.25 },
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
    <div className="aurora-designer__canvas-wrap" onKeyDown={onKeyDown}>
      <div className="aurora-designer__toolbar" role="toolbar" aria-label="Diagram tools">
        <Button size="sm" variant="secondary" onClick={guard(() => p.onAdd("task"))}>Add activity</Button>
        <Button size="sm" variant="secondary" onClick={guard(() => p.onAdd("exclusiveGateway"))}>Add gateway</Button>
        <Button size="sm" variant="secondary" onClick={guard(() => p.onAdd("endEvent"))}>Add event</Button>
        <Button size="sm" variant="secondary" onClick={guard(p.onLayout)}>Auto-layout</Button>
        <Button size="sm" variant={connectMode ? "primary" : "secondary"} aria-pressed={connectMode}
          onClick={() => (p.editable ? setConnectMode((v) => !v) : p.onBlocked())}>Connect mode</Button>
        <Button size="sm" variant="ghost" disabled={!selNode && !selFlow} onClick={remove}>Delete selected</Button>
        {askDelete ? (
          <span className="aurora-designer__ask" role="alertdialog" aria-label="Delete activity">
            Also delete the activity?
            <Button size="sm" variant="secondary" onClick={() => { p.onDeleteNode(askDelete, true); setAskDelete(null); }}>Delete both</Button>
            <Button size="sm" variant="ghost" onClick={() => { p.onDeleteNode(askDelete, false); setAskDelete(null); }}>Step only</Button>
            <Button size="sm" variant="ghost" onClick={() => setAskDelete(null)}>Keep both</Button>
          </span>
        ) : null}
      </div>
      <div className="aurora-process-graph aurora-designer__canvas" data-connect={connectMode || undefined}>
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
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--aurora-canvas-line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function DesignerCanvas(p: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
