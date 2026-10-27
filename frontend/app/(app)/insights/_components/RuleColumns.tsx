"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Mono, Pill, type PillTone, Status } from "@/design";
import type { RuleRow } from "@/lib/api/insights";
import { drillLabel, fixHref } from "@/lib/drill";
import { formatModuleName, labelOf } from "@/lib/format";
import { DrillCount } from "./DrillCount";

const S4_TONE: Record<string, PillTone> = { blocking: "no-go", warning: "at-risk" };

const n = (v: number) => v.toLocaleString();

/** Columns of the failing-rules table. `compact` is the overview and exec subset. */
export function ruleColumns(run: string | undefined, compact = false): ColumnDef<RuleRow>[] {
  const recordsHref = (r: RuleRow) => fixHref({ run, module: r.module, check: r.check_id });
  const objectHref = (r: RuleRow) => `/objects/${r.module}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", check: r.check_id })}`;
  const cols: ColumnDef<RuleRow>[] = [
    // Plain words first, the check id under them as the secondary key.
    {
      id: "rule", header: "Rule", accessorFn: (r) => r.name || r.check_id,
      cell: ({ row }) => (
        <span className="flex flex-col [min-width:14rem]">
          <span className="line-clamp-2" title={row.original.name || row.original.check_id}>
            <DrillCount href={recordsHref(row.original)} count={row.original.affected} label={drillLabel({ what: "failing records", check: row.original.check_id, module: row.original.module })}>{row.original.name || row.original.check_id}</DrillCount>
          </span>
          {row.original.name ? <span className="m-text-meta m-ink-3"><Mono>{row.original.check_id}</Mono></span> : null}
        </span>
      ),
    },
    {
      id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module),
      cell: ({ row }) => <Link href={objectHref(row.original)} onClick={(e) => e.stopPropagation()} className="underline-offset-2 hover:underline">{formatModuleName(row.original.module)}</Link>,
    },
    { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  ];
  if (!compact) cols.push({ id: "dimension", header: "Dimension", accessorFn: (r) => labelOf(r.dimension) });
  cols.push({ accessorKey: "affected", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => (
    <DrillCount href={recordsHref(row.original)} count={row.original.affected} label={drillLabel({ count: row.original.affected, what: "failing records", check: row.original.check_id, module: row.original.module })}>{n(row.original.affected)}</DrillCount>
  ) });
  if (!compact) {
    cols.push(
      { accessorKey: "total", header: "Records checked", meta: { numeric: true }, cell: ({ row }) => n(row.original.total) },
      {
        id: "pass_rate", header: "Pass rate", meta: { numeric: true }, accessorFn: (r) => r.pass_rate ?? -1,
        cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${Math.round(row.original.pass_rate * 1000) / 10}%`),
      },
    );
  }
  cols.push(
    { accessorKey: "impact", header: "Weighted failures", meta: { numeric: true }, cell: ({ row }) => n(row.original.impact) },
    { accessorKey: "auto_fix_pct", header: "Auto-fixable", meta: { numeric: true }, cell: ({ row }) => `${Math.round(row.original.auto_fix_pct)}%` },
    { accessorKey: "s4", header: "S/4 load", cell: ({ row }) => <Pill tone={S4_TONE[row.original.s4] ?? "neutral"}>{labelOf(row.original.s4)}</Pill> },
  );
  if (!compact) {
    cols.push({
      id: "delta", header: "Change since last run", meta: { numeric: true }, accessorFn: (r) => r.delta_affected ?? 0,
      cell: ({ row }) => (row.original.delta_affected === null ? "—" : `${row.original.delta_affected > 0 ? "+" : ""}${n(row.original.delta_affected)}`),
    });
  }
  if (compact) {
    // The ledger's one action: the rule on its object.
    cols.push({
      id: "action", header: "", enableSorting: false,
      cell: ({ row }) => <Link href={objectHref(row.original)} onClick={(e) => e.stopPropagation()} aria-label={`Open rule ${row.original.check_id} on ${formatModuleName(row.original.module)}`} className="m-ink-accent underline underline-offset-2">Open</Link>,
    });
  }
  return cols;
}
