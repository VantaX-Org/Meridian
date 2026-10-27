"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Pill, type PillTone, Status } from "@/design";
import type { RuleRow } from "@/lib/api/insights";
import { drillLabel, fixHref } from "@/lib/drill";
import { formatModuleName, labelOf } from "@/lib/format";
import { ddicRuleName, ruleWords } from "@/lib/rule-name";
import { RuleCell } from "@/components/fix/rule-cell";
import { DrillCount } from "./DrillCount";

const S4_TONE: Record<string, PillTone> = { blocking: "no-go", warning: "at-risk" };

const n = (v: number) => v.toLocaleString();

/** The ranking's own words for a rule (a YAML message, never the bare id), else the DDIC check's: the sort key. */
const rowWords = (r: RuleRow) => ruleWords(r.check_id, r.name) ?? ddicRuleName(r.check_id) ?? undefined;

/**
 * The rule as every ledger names it (RuleCell: the check id on its own line, the words under it by the one
 * precedence: catalogue name, then the ranking's message, then generated words), linked to its failing records.
 */
function RuleWordsCell({ row, href }: { row: RuleRow; href: string }) {
  return (
    <span className="flex [min-width:14rem]">
      <DrillCount href={href} count={row.affected} label={drillLabel({ what: "failing records", check: row.check_id, module: row.module })}>
        <RuleCell id={row.check_id} fallback={row.name} />
      </DrillCount>
    </span>
  );
}

/** Columns of the failing-rules table. `compact` is the overview and exec subset. */
export function ruleColumns(run: string | undefined, compact = false): ColumnDef<RuleRow>[] {
  const recordsHref = (r: RuleRow) => fixHref({ run, module: r.module, check: r.check_id });
  const objectHref = (r: RuleRow) => `/objects/${r.module}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", check: r.check_id })}`;
  const cols: ColumnDef<RuleRow>[] = [
    // The check id, the rule's words under it (RuleCell), as on every other ledger.
    {
      // A DDIC conformance check has no catalogue name: its id names the table and the kind of check.
      id: "rule", header: "Rule", accessorFn: (r) => rowWords(r) ?? r.check_id,
      cell: ({ row }) => <RuleWordsCell row={row.original} href={recordsHref(row.original)} />,
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
