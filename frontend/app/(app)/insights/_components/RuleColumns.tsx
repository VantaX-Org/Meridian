"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Mono, Pill, type PillTone, Status } from "@/design";
import type { RuleRow } from "@/lib/api/insights";
import { formatModuleName, labelOf } from "@/lib/format";

const S4_TONE: Record<string, PillTone> = { blocking: "no-go", warning: "at-risk" };

const n = (v: number) => v.toLocaleString();

/** Columns of the failing-rules table. `compact` is the overview and exec subset. */
export function ruleColumns(run: string | undefined, compact = false): ColumnDef<RuleRow>[] {
  const objectHref = (r: RuleRow) => `/objects/${r.module}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", check: r.check_id })}`;
  const cols: ColumnDef<RuleRow>[] = [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="line-clamp-2 [min-width:14rem]" title={row.original.name}>{row.original.name}</span> },
    {
      id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module),
      cell: ({ row }) => <Link href={objectHref(row.original)} onClick={(e) => e.stopPropagation()} className="underline-offset-2 hover:underline">{formatModuleName(row.original.module)}</Link>,
    },
    { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  ];
  if (!compact) cols.push({ id: "dimension", header: "Dimension", accessorFn: (r) => labelOf(r.dimension) });
  cols.push({ accessorKey: "affected", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => n(row.original.affected) });
  if (!compact) {
    cols.push(
      { accessorKey: "total", header: "Total", meta: { numeric: true }, cell: ({ row }) => n(row.original.total) },
      {
        id: "pass_rate", header: "Pass rate", meta: { numeric: true }, accessorFn: (r) => r.pass_rate ?? -1,
        cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${Math.round(row.original.pass_rate * 1000) / 10}%`),
      },
    );
  }
  cols.push(
    { accessorKey: "impact", header: "Impact", meta: { numeric: true }, cell: ({ row }) => n(row.original.impact) },
    { accessorKey: "auto_fix_pct", header: "Auto-fix", meta: { numeric: true }, cell: ({ row }) => `${Math.round(row.original.auto_fix_pct)}%` },
    { accessorKey: "s4", header: "S/4", cell: ({ row }) => <Pill tone={S4_TONE[row.original.s4] ?? "neutral"}>{labelOf(row.original.s4)}</Pill> },
  );
  if (!compact) {
    cols.push({
      id: "delta", header: "Change", meta: { numeric: true }, accessorFn: (r) => r.delta_affected ?? 0,
      cell: ({ row }) => (row.original.delta_affected === null ? "—" : `${row.original.delta_affected > 0 ? "+" : ""}${n(row.original.delta_affected)}`),
    });
  }
  return cols;
}
