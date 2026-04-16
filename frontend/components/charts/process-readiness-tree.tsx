"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatModuleName } from "@/lib/format";
import type {
  BusinessProcessL1,
  BusinessProcessL2,
  BusinessProcessL3,
  BusinessProcessL4Step,
  BusinessProcessL5Field,
} from "@/types/api";

const STATUS_COLORS: Record<string, string> = {
  green: "bg-[#16A34A]",
  amber: "bg-[#D97706]",
  red: "bg-destructive",
};

const STATUS_BADGE: Record<string, string> = {
  green: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
  amber: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
  red: "bg-destructive/10 text-destructive border-destructive/20",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status] ?? "bg-muted-foreground"}`} />
  );
}

function L5FieldRow({ field }: { field: BusinessProcessL5Field }) {
  return (
    <tr className="border-b border-black/[0.04] last:border-0">
      <td className="px-3 py-1.5 text-xs font-medium text-foreground">{field.field}</td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[200px] truncate">{field.description}</td>
      <td className="px-3 py-1.5">
        <StatusDot status={field.dq_status} />
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {field.pass_rate !== null ? `${field.pass_rate.toFixed(1)}%` : "--"}
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {field.mandatory && (
          <Badge variant="outline" className="text-[9px] px-1 py-0">Required</Badge>
        )}
      </td>
    </tr>
  );
}

function L4Node({ step }: { step: BusinessProcessL4Step }) {
  const [expanded, setExpanded] = useState(false);
  const hasFields = step.l5_fields.length > 0;

  return (
    <div className="ml-8">
      <button
        type="button"
        onClick={() => hasFields && setExpanded(!expanded)}
        disabled={!hasFields}
        className="flex items-center gap-2 py-1.5 text-left w-full hover:bg-white/[0.40] rounded-md px-2 transition-colors"
      >
        {hasFields ? (
          expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <span className="w-3.5" />
        )}
        <StatusDot status={step.step_status} />
        <span className="text-xs font-medium text-foreground">{step.l4_name}</span>
        {hasFields && (
          <span className="text-[10px] text-muted-foreground">({step.l5_fields.length} fields)</span>
        )}
      </button>

      {expanded && hasFields && (
        <div className="ml-6 mt-1 mb-2 overflow-x-auto rounded-lg border border-black/[0.06]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.06] bg-white/[0.40]">
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Field</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Description</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">DQ</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Pass Rate</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Info</th>
              </tr>
            </thead>
            <tbody>
              {step.l5_fields.map((f) => (
                <L5FieldRow key={f.field} field={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function L3Node({ process }: { process: BusinessProcessL3 }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ml-6">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 text-left w-full hover:bg-white/[0.40] rounded-md px-2 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">{process.l3_name}</span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[process.overall_readiness] ?? ""}`}>
          {process.overall_readiness}
        </Badge>
        {process.tcode && (
          <span className="text-[10px] font-mono text-muted-foreground">{process.tcode}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-1">
          {process.l4_steps.map((step) => (
            <L4Node key={step.l4_id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function L2Node({ group }: { group: BusinessProcessL2 }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ml-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-2 text-left w-full hover:bg-white/[0.40] rounded-md px-2 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground">{group.l2_name}</span>
        <span className="text-xs text-muted-foreground">({group.l3_processes.length} processes)</span>
      </button>

      {expanded && (
        <div className="mt-0.5">
          {group.l3_processes.map((proc) => (
            <L3Node key={proc.l3_id} process={proc} />
          ))}
        </div>
      )}
    </div>
  );
}

function L1Node({ area }: { area: BusinessProcessL1 }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-black/[0.08] bg-white/[0.70] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-white/[0.50] transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <div>
          <span className="text-base font-semibold text-foreground">{area.l1_name}</span>
          {area.l1_description && (
            <p className="text-xs text-muted-foreground mt-0.5">{area.l1_description}</p>
          )}
        </div>
        <Badge variant="outline" className="ml-auto text-[10px] border-black/[0.08]">
          {area.system}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t border-black/[0.06] px-2 py-2">
          {area.l2_groups.map((group) => (
            <L2Node key={group.l2_id} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProcessReadinessTreeProps {
  processes: BusinessProcessL1[];
}

export function ProcessReadinessTree({ processes }: ProcessReadinessTreeProps) {
  if (processes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Circle className="h-10 w-10 text-muted-foreground/30" />
        <p className="mt-3 text-sm text-muted-foreground">
          No business process data available for this selection
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {processes.map((area) => (
        <L1Node key={area.l1_id} area={area} />
      ))}
    </div>
  );
}
