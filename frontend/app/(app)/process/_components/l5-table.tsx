"use client";

/** The L5 table of one L4 (process-discovery spec §4.4): every activity with its mined figures. */
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Mono, Pill, type PillTone } from "@/design";
import type { L4, L5, NodeSource } from "@/types/process-model";
import { fmtCount, fmtFitness, fmtSeconds, fmtShare } from "./shared";

export const SOURCE: Record<NodeSource, { label: string; tone: PillTone }> = {
  template: { label: "Reference", tone: "neutral" },
  config: { label: "Config", tone: "info" },
  discovered: { label: "Discovered", tone: "go" },
};

/**
 * `onOpen` opens an activity's detail; without it (the reference tab, which has no detail to open) names are plain
 * text. An activity with no mined figures reads "—", never 0 cases or 0.0%.
 */
export function L5Table({ l4, onOpen }: { l4: L4; onOpen?: (id: string) => void }) {
  const columns: ColumnDef<L5>[] = [
    { accessorKey: "id", header: "ID", cell: ({ row }) => <Mono>{row.original.id}</Mono> },
    { accessorKey: "name", header: "Label", cell: ({ row }) => (onOpen
        ? <button type="button" className="ui-link-button" onClick={() => onOpen(row.original.id)}>{row.original.name}</button>
        : row.original.name) },
    { id: "source", header: "Source", cell: ({ row }) => {
        const s = SOURCE[row.original.source ?? "template"];
        return <Pill tone={s.tone}>{s.label}</Pill>;
      } },
    { id: "cases", header: "Cases", accessorFn: (a) => a.discovery?.case_count ?? -1, cell: ({ row }) => fmtCount(row.original.discovery?.case_count) },
    { id: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.discovery?.share) },
    { id: "median", header: "Median", cell: ({ row }) => fmtSeconds(row.original.discovery?.median_seconds) },
    { id: "p90", header: "P90", cell: ({ row }) => fmtSeconds(row.original.discovery?.p90_seconds) },
    { id: "rework", header: "Rework", cell: ({ row }) => fmtShare(row.original.discovery?.rework_rate) },
    { id: "automation", header: "Automation", cell: ({ row }) => fmtShare(row.original.discovery?.automation_rate) },
    { id: "fitness", header: "Fitness", cell: ({ row }) => fmtFitness(row.original.discovery?.fitness) },
    { accessorKey: "tcode", header: "T-code", cell: ({ row }) => (row.original.tcode ? <Mono>{row.original.tcode}</Mono> : "—") },
    { id: "fields", header: "Fields", cell: ({ row }) => fmtCount(row.original.fields.length) },
  ];
  return (
    <DataTable columns={columns} data={l4.activities} getRowId={(a) => a.id} height="auto" dense
      tableId="process-l5" exportName={`process-${l4.id}-activities`} />
  );
}
