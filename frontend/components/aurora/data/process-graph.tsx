/**
 * Aurora <ProcessGraph> — WS3.
 *
 * React Flow + Dagre layout wrapped in an Aurora-themed canvas. Consumers
 * pass nodes and edges in the Aurora shape; layout is computed with Dagre
 * on mount and on every `nodes`/`edges` change. Nodes render with the
 * Aurora node card (id, label, step kind, aligned/drifting status tag).
 *
 * Signature moments that rely on this primitive:
 *   • Process-graph emergence (§12, WS5) — nodes fade + scale in 360 ms.
 *   • Config-impact drawer drill (§2.5.2) — click a node to open a filtered
 *     Record list; wired in WS7.
 *
 * Under `prefers-reduced-motion` the materialisation becomes an instant cut
 * (see aurora.css §5.5.1 — medium + slow are zeroed).
 */

"use client";

import "@xyflow/react/dist/style.css";
import * as dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { clsx } from "../primitives/internal";
import { Text } from "../primitives";

export type ProcessStepKind =
  | "source"
  | "transform"
  | "decision"
  | "approval"
  | "sink";

export type ProcessAlignment = "aligned" | "drifting" | "blocked" | "unknown";

export interface ProcessNodeData extends Record<string, unknown> {
  label: string;
  kind: ProcessStepKind;
  alignment: ProcessAlignment;
  /** Optional short identifier rendered above the label. */
  stepId?: string;
  /** Optional secondary line, e.g. "3 variants · 124 cases". */
  secondary?: string;
}

export interface ProcessEdgeData extends Record<string, unknown> {
  label?: string;
}

type AuroraNode = Node<ProcessNodeData, "auroraProcess">;
type AuroraEdge = Edge<ProcessEdgeData>;

export interface ProcessGraphProps {
  nodes: Omit<AuroraNode, "position" | "type">[];
  edges: AuroraEdge[];
  /** Dagre layout direction. `LR` (default) reads left→right. */
  direction?: "LR" | "TB";
  height?: number | string;
  onNodeClick?: (node: AuroraNode) => void;
  className?: string;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 72;

function layoutWithDagre(
  nodes: Omit<AuroraNode, "position" | "type">[],
  edges: AuroraEdge[],
  direction: "LR" | "TB",
): AuroraNode[] {
  const graph = new dagre.graphlib.Graph({ multigraph: false });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    ranksep: 56,
    nodesep: 32,
    marginx: 24,
    marginy: 24,
  });
  nodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return nodes.map((node): AuroraNode => {
    const { x, y } = graph.node(node.id);
    return {
      ...node,
      type: "auroraProcess",
      position: {
        x: x - NODE_WIDTH / 2,
        y: y - NODE_HEIGHT / 2,
      },
    };
  });
}

export function ProcessGraph({
  nodes: rawNodes,
  edges: rawEdges,
  direction = "LR",
  height = 480,
  onNodeClick,
  className,
}: ProcessGraphProps) {
  const initialNodes = useMemo(
    () => layoutWithDagre(rawNodes, rawEdges, direction),
    [rawNodes, rawEdges, direction],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<AuroraNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AuroraEdge>(rawEdges);

  // Re-run layout whenever the input shape changes.
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(rawEdges);
  }, [initialNodes, rawEdges, setNodes, setEdges]);

  return (
    <div
      className={clsx("aurora-process-graph", className)}
      style={{ width: "100%", height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeClick?.(node as AuroraNode)}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
          style: {
            stroke: "var(--aurora-canvas-line)",
            strokeWidth: 1.25,
          },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--aurora-canvas-line)"
        />
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          position="bottom-right"
        />
      </ReactFlow>
    </div>
  );
}

/* ---------------------------------------------------------- Custom node --- */

const nodeTypes = {
  auroraProcess: AuroraProcessNode,
};

function AuroraProcessNode({ data, selected }: NodeProps<AuroraNode>) {
  return (
    <div
      className="aurora-process-node"
      data-kind={data.kind}
      data-alignment={data.alignment}
      data-selected={selected ? "true" : undefined}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {data.stepId ? (
        <Text variant="text-micro" tone="tertiary">
          {data.stepId}
        </Text>
      ) : null}
      <Text variant="text-small" className="aurora-process-node__label">
        {data.label}
      </Text>
      {data.secondary ? (
        <Text variant="text-micro" tone="muted">
          {data.secondary}
        </Text>
      ) : null}
      <span
        className="aurora-process-node__alignment"
        aria-label={data.alignment}
      />
    </div>
  );
}
