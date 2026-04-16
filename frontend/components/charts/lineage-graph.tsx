"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { LineageGraph, LineageNode } from "@/types/api";

const NODE_COLOURS: Record<string, string> = {
  record: "#00D4AA",
  finding: "#6366F1",
  exception: "#DC2626",
  cleaning: "#EA580C",
  dedup: "#7C3AED",
  relationship: "#2563EB",
};

const NODE_RADIUS = 18;

interface LineageGraphProps {
  graph: LineageGraph;
  width?: number;
  height?: number;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  data: Record<string, unknown>;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  label: string;
}

export default function LineageGraphComponent({
  graph,
  width = 700,
  height = 500,
}: LineageGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: LineageNode;
  } | null>(null);

  useEffect(() => {
    if (!svgRef.current || graph.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    // Build a lookup of node data by id for edge styling
    const nodeDataById: Record<string, Record<string, unknown>> = {};
    graph.nodes.forEach((n) => { nodeDataById[n.id] = n.data; });

    const links: SimLink[] = graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
    }));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(120),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(NODE_RADIUS + 10));

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        // Relationship edges get a distinct colour
        const targetId = typeof d.target === "string" ? d.target : (d.target as SimNode).id;
        const targetNode = graph.nodes.find((n) => n.id === targetId);
        return targetNode?.type === "relationship" ? "#2563EB" : "rgba(0,0,0,0.12)";
      })
      .attr("stroke-width", (d) => {
        // Edge weight = impact_score (thicker = higher impact)
        const targetId = typeof d.target === "string" ? d.target : (d.target as SimNode).id;
        const impact = nodeDataById[targetId]?.impact_score as number | undefined;
        return impact ? 1.5 + impact * 3 : 1.5;
      })
      .attr("stroke-opacity", 0.7)
      .attr("stroke-dasharray", (d) => {
        // Dashed line for ai_inferred relationships
        const targetId = typeof d.target === "string" ? d.target : (d.target as SimNode).id;
        const isAiInferred = nodeDataById[targetId]?.ai_inferred as boolean | undefined;
        return isAiInferred ? "6,3" : "none";
      });

    const linkLabel = g
      .append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .text((d) => d.label)
      .attr("font-size", 9)
      .attr("fill", "#6B7280")
      .attr("text-anchor", "middle");

    const dragBehavior = d3.drag<SVGCircleElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d) => NODE_COLOURS[d.type] || "#6B7280")
      .attr("stroke", "rgba(0,0,0,0.12)")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .on("mouseover", (event, d) => {
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltip({ x, y, node: d as LineageNode });
      })
      .on("mouseout", () => setTooltip(null))
      .call(dragBehavior as any);

    const nodeLabel = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => d.label.length > 20 ? d.label.slice(0, 20) + "..." : d.label)
      .attr("font-size", 10)
      .attr("fill", "#1A1F36")
      .attr("text-anchor", "middle")
      .attr("dy", NODE_RADIUS + 14);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);

      linkLabel
        .attr("x", (d) =>
          (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2,
        )
        .attr("y", (d) =>
          (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2 - 6,
        );

      node
        .attr("cx", (d) => d.x ?? 0)
        .attr("cy", (d) => d.y ?? 0);

      nodeLabel
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [graph, width, height]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No lineage data found for this record.
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="rounded-lg border border-black/[0.08] bg-white/[0.60]"
      />
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {Object.entries(NODE_COLOURS).map(([type, colour]) => (
          <div key={type} className="flex items-center gap-1">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: colour }}
            />
            <span className="text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg bg-[rgba(255,255,255,0.92)] backdrop-blur-xl border border-black/[0.10] px-3 py-2 shadow-lg"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <p className="text-xs font-semibold capitalize text-foreground">
            {tooltip.node.type}
          </p>
          <p className="text-xs text-muted-foreground">{tooltip.node.label}</p>
          {Object.entries(tooltip.node.data)
            .slice(0, 4)
            .map(([k, v]) => (
              <p key={k} className="text-[10px] text-secondary-foreground">
                {k}: {String(v ?? "-")}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
