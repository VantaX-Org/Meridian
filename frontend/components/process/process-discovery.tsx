/**
 * Process Discovery & Conformance Components — React Flow integration
 * 
 * Provides workflow visualization for:
 * - Business process discovery from SAP data
 * - Process conformance checking
 * - Anomaly detection in workflows
 * - React Flow-based node graph editor
 * 
 * For WS14 from Meridian v3.0 spec §6.
 */

import { useState, useCallback, useEffect } from "react";

/**
 * Process node types for React Flow
 */
export interface ProcessNode {
  id: string;
  type: "activity" | "gateway" | "event" | "start" | "end";
  label: string;
  frequency?: number;
  avgDuration?: number;
  isAnomalous?: boolean;
  position?: { x: number; y: number };
}

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  frequency?: number;
  isConforming?: boolean;
}

export interface ProcessModel {
  id: string;
  name: string;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  conformanceScore?: number;
}

/**
 * Process Discovery Card — displays discovered process with conformance
 */
export function ProcessDiscoveryCard({
  process,
  onNodeClick,
  onEdgeClick
}: {
  process: ProcessModel;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
}) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
    onNodeClick?.(nodeId);
  }, [onNodeClick]);
  
  return (
    <div className="vx-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[#1A1F36]">{process.name}</h3>
        {process.conformanceScore !== undefined && (
          <div className={`vx-glass-pill px-3 py-1 ${
            process.conformanceScore >= 90 ? "bg-[#256F3A]/10 text-[#256F3A]" :
            process.conformanceScore >= 70 ? "bg-[#E76500]/10 text-[#E76500]" :
            "bg-[#BB0000]/10 text-[#BB0000]"
          }`}>
            {process.conformanceScore}% Conforming
          </div>
        )}
      </div>
      
      {/* Process visualization placeholder */}
      <div 
        className="relative h-64 bg-[#F7F8FA] rounded-lg overflow-hidden mb-4"
        onClick={() => {}}
      >
        <ProcessFlowVisualization 
          nodes={process.nodes}
          edges={process.edges}
          selectedNode={selectedNode}
          onNodeClick={handleNodeClick}
        />
      </div>
      
      {/* Process statistics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-lg font-bold text-[#1A1F36]">
            {process.nodes.length}
          </div>
          <div className="text-xs text-[#6B7280]">Activities</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-[#1A1F36]">
            {process.edges.length}
          </div>
          <div className="text-xs text-[#6B7280]">Transitions</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-[#1A1F36]">
            {process.nodes.filter(n => n.isAnomalous).length}
          </div>
          <div className="text-xs text-[#6B7280]">Anomalies</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Simplified process flow visualization (placeholder for React Flow)
 */
function ProcessFlowVisualization({
  nodes,
  edges,
  selectedNode,
  onNodeClick
}: {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  selectedNode: string | null;
  onNodeClick: (nodeId: string) => void;
}) {
  // Simple horizontal layout for visualization
  const nodeWidth = 80;
  const nodeSpacing = 100;
  const startX = 50;
  const startY = 100;
  
  return (
    <svg width="100%" height="100%" className="bg-[#F7F8FA]">
      {/* Edges */}
      {edges.map((edge, idx) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        
        if (!sourceNode || !targetNode) return null;
        
        const sourceIdx = nodes.indexOf(sourceNode);
        const targetIdx = nodes.indexOf(targetNode);
        
        const x1 = startX + sourceIdx * nodeSpacing + nodeWidth;
        const y1 = startY;
        const x2 = startX + targetIdx * nodeSpacing;
        const y2 = startY;
        
        return (
          <g key={edge.id}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={edge.isConforming === false ? "#BB0000" : "#6B7280"}
              strokeWidth={2}
              strokeDasharray={edge.isConforming === false ? "5,5" : ""}
            />
            {edge.frequency !== undefined && (
              <text
                x={(x1 + x2) / 2}
                y={y1 - 8}
                fontSize={10}
                fill="#6B7280"
                textAnchor="middle"
              >
                {edge.frequency}%
              </text>
            )}
          </g>
        );
      })}
      
      {/* Nodes */}
      {nodes.map((node, idx) => {
        const x = startX + idx * nodeSpacing;
        
        return (
          <g 
            key={node.id}
            onClick={() => onNodeClick(node.id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={x}
              y={startY - 15}
              width={nodeWidth}
              height={30}
              rx={4}
              fill={
                node.isAnomalous ? "#BB0000" :
                node.type === "start" ? "#256F3A" :
                node.type === "end" ? "#7858FF" :
                selectedNode === node.id ? "#0070F2" :
                "#FFFFFF"
              }
              stroke={
                node.isAnomalous ? "#BB0000" :
                selectedNode === node.id ? "#0057D2" :
                "#E5E7EB"
              }
              strokeWidth={2}
            />
            <text
              x={x + nodeWidth / 2}
              y={startY + 5}
              fontSize={11}
              fill={
                node.isAnomalous || selectedNode === node.id ?
                "#FFFFFF" : "#1A1F36"
              }
              textAnchor="middle"
            >
              {node.label.length > 12 
                ? node.label.substring(0, 12) + "..." 
                : node.label}
            </text>
            {node.frequency !== undefined && (
              <text
                x={x + nodeWidth / 2}
                y={startY + 25}
                fontSize={9}
                fill="#6B7280"
                textAnchor="middle"
              >
                {node.frequency}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Conformance Result Card — shows process conformance check results
 */
export function ConformanceResultCard({
  results
}: {
  results: {
    totalCases: number;
    conformingCases: number;
    nonConformingCases: number;
    conformanceRate: number;
    anomalies: Array<{
      caseId: string;
      deviationType: string;
      expectedPath: string;
      actualPath: string;
      timestamp: string;
    }>;
  };
}) {
  return (
    <div className="vx-card p-5">
      <h3 className="font-semibold text-[#1A1F36] mb-4">Conformance Check Results</h3>
      
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-[#1A1F36]">
            {results.totalCases.toLocaleString()}
          </div>
          <div className="text-xs text-[#6B7280]">Total Cases</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-[#256F3A]">
            {results.conformingCases.toLocaleString()}
          </div>
          <div className="text-xs text-[#6B7280]">Conforming</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-[#BB0000]">
            {results.nonConformingCases.toLocaleString()}
          </div>
          <div className="text-xs text-[#6B7280]">Non-Conforming</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${
            results.conformanceRate >= 90 ? "text-[#256F3A]" :
            results.conformanceRate >= 70 ? "text-[#E76500]" :
            "text-[#BB0000]"
          }`}>
            {results.conformanceRate.toFixed(1)}%
          </div>
          <div className="text-xs text-[#6B7280]">Compliance</div>
        </div>
      </div>
      
      {/* Conformance bar */}
      <div className="h-3 w-full bg-[#F7F8FA] rounded-full overflow-hidden mb-4">
        <div 
          className={`h-full rounded-full transition-all ${
            results.conformanceRate >= 90 ? "bg-[#256F3A]" :
            results.conformanceRate >= 70 ? "bg-[#E76500]" :
            "bg-[#BB0000]"
          }`}
          style={{ width: `${results.conformanceRate}%` }}
        />
      </div>
      
      {/* Anomalies list */}
      {results.anomalies.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-[#1A1F36] mb-2">Detected Anomalies</h4>
          <div className="space-y-2 max-h-48 overflow-auto">
            {results.anomalies.slice(0, 10).map((anomaly, idx) => (
              <div 
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.15)]"
              >
                <div>
                  <div className="text-sm font-medium text-[#1A1F36]">
                    Case: {anomaly.caseId}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    {anomaly.deviationType}
                  </div>
                </div>
                <div className="text-xs text-[#6B7280]">
                  {anomaly.timestamp}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Process Timeline — shows process steps over time
 */
export function ProcessTimeline({
  steps,
  currentStep
}: {
  steps: Array<{
    label: string;
    status: "pending" | "active" | "complete" | "failed";
    duration?: string;
    timestamp?: string;
  }>;
  currentStep: number;
}) {
  return (
    <div className="vx-card p-5">
      <h3 className="font-semibold text-[#1A1F36] mb-4">Process Timeline</h3>
      
      <div className="space-y-4">
        {steps.map((step, idx) => {
          const isPast = idx < currentStep;
          const isCurrent = idx === currentStep;
          const isFuture = idx > currentStep;
          
          const statusColors = {
            pending: "bg-[#E5E7EB]",
            active: "bg-[#0070F2]",
            complete: "bg-[#256F3A]",
            failed: "bg-[#BB0000]",
          };
          
          return (
            <div key={idx} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-4 h-4 rounded-full ${statusColors[step.status]} ${
                  isCurrent ? "ring-4 ring-[#0070F2]/20" : ""
                }`} />
                {idx < steps.length - 1 && (
                  <div className={`w-px h-8 ${
                    isPast ? "bg-[#256F3A]" : "bg-[#E5E7EB]"
                  }`} />
                )}
              </div>
              
              <div className="flex-1 pb-4">
                <div className={`text-sm font-medium ${
                  isFuture ? "text-[#6B7280]" : "text-[#1A1F36]"
                }`}>
                  {step.label}
                </div>
                {step.duration && (
                  <div className="text-xs text-[#6B7280] mt-1">
                    Duration: {step.duration}
                  </div>
                )}
                {step.timestamp && (
                  <div className="text-xs text-[#6B7280]">
                    {step.timestamp}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
