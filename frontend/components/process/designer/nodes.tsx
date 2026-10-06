"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Mono } from "@/components/ui-core";
import type { DqColour, Evidence } from "@/types/process-model";

const ALIGN: Record<DqColour, string> = { green: "aligned", amber: "drifting", red: "blocked" };

export interface TaskData extends Record<string, unknown> {
  name: string; tcode: string | null; fields: number; rules: number;
  status?: DqColour; evidence?: Evidence | null; selected: boolean;
}
export interface MarkData extends Record<string, unknown> { label: string; end?: boolean; selected: boolean; parallel?: boolean }

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function Task({ data }: NodeProps<Node<TaskData>>) {
  const notExtracted = data.evidence === "not_extracted";
  return (
    <div className="aurora-process-node aurora-bpmn-task" data-selected={data.selected}
      data-alignment={data.status ? ALIGN[data.status] : undefined} data-evidence={data.evidence ?? undefined}>
      <Handles />
      {data.tcode ? <span className="aurora-bpmn-task__tcode"><Mono>{data.tcode}</Mono></span> : null}
      <span className="aurora-process-node__label">{data.name}</span>
      <span className="aurora-bpmn-task__meta">{plural(data.fields, "field")}, {plural(data.rules, "rule")}</span>
      <span className="aurora-process-node__alignment" />
      {notExtracted ? <span className="aurora-bpmn-task__evidence" title="No document table extracted for this step" /> : null}
    </div>
  );
}

function Gateway({ data }: NodeProps<Node<MarkData>>) {
  return (
    <div className="aurora-bpmn-gateway" data-selected={data.selected} data-parallel={data.parallel || undefined}>
      <Handles />
      <span className="aurora-bpmn-gateway__shape" aria-hidden />
      <span className="aurora-bpmn-gateway__label">{data.label}</span>
    </div>
  );
}

function Event({ data }: NodeProps<Node<MarkData>>) {
  return (
    <div className="aurora-bpmn-event" data-end={data.end || undefined} data-selected={data.selected}
      role="img" aria-label={data.end ? "End event" : "Start event"}>
      <Handles />
    </div>
  );
}

export const nodeTypes = { bpmnTask: Task, bpmnGateway: Gateway, bpmnEvent: Event };
