"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Card, Mono } from "@/design";
import type { DomainKey } from "@/design/tokens";
import type { DqColour, Evidence } from "@/types/process-model";

const ALIGN: Record<DqColour, string> = { green: "aligned", amber: "drifting", red: "blocked" };

export interface TaskData extends Record<string, unknown> {
  name: string; tcode: string | null; fields: number; rules: number;
  status?: DqColour; failing?: number; affected?: number; evidence?: Evidence | null; selected: boolean;
  domain?: DomainKey;
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
    <div className="m-process-node" data-selected={data.selected}
      data-alignment={data.status ? ALIGN[data.status] : undefined} data-evidence={data.evidence ?? undefined}>
      <Handles />
      <div className="m-process-node__clip">
      {data.domain ? <span aria-hidden data-domain={data.domain} className="m-domain-stripe" /> : null}
      <Card padding="sm">
        <div className="flex flex-col gap-0.5">
          {data.tcode ? <span className="m-text-meta m-ink-3"><Mono>{data.tcode}</Mono></span> : null}
          <span className="m-text-body font-medium m-ink">{data.name}</span>
          <span className="m-text-meta m-ink-3">{plural(data.fields, "field")}, {plural(data.rules, "rule")}</span>
          {data.failing != null && data.failing > 0 ? (
            <span className="m-text-meta m-ink-3">{plural(data.failing, "rule")} failing, {plural(data.affected ?? 0, "record")} open</span>
          ) : null}
        </div>
      </Card>
      </div>
      <span className="m-process-node__alignment" />
      {notExtracted ? <span className="m-bpmn-task__evidence" title="No document table extracted for this step" /> : null}
    </div>
  );
}

function Gateway({ data }: NodeProps<Node<MarkData>>) {
  return (
    <div className="m-bpmn-gateway" data-selected={data.selected} data-parallel={data.parallel || undefined}>
      <Handles />
      <span className="m-bpmn-gateway__shape" aria-hidden />
      <span className="m-bpmn-gateway__label m-text-meta m-ink-2">{data.label}</span>
    </div>
  );
}

function Event({ data }: NodeProps<Node<MarkData>>) {
  return (
    <div className="m-bpmn-event" data-end={data.end || undefined} data-selected={data.selected}
      role="img" aria-label={data.end ? "End event" : "Start event"}>
      <Handles />
    </div>
  );
}

export const nodeTypes = { bpmnTask: Task, bpmnGateway: Gateway, bpmnEvent: Event };
