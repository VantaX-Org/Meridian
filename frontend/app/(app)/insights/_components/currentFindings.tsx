"use client";

// The current state's Fix first ledger (the executive summary's): each object's findings from the latest finished run
// of its lineage (lib/current-state.ts), highest impact first. It came from the retired Insights overview.
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { buildDrillHref, Mono, Status } from "@/design";
import type { StateObject } from "@/lib/current-state";
import { checkClassLabel, formatModuleName } from "@/lib/format";
import { drillLabel, fixHref } from "@/lib/drill";
import { useRuleNames } from "@/lib/rule-name";
import type { Finding } from "@/types/api";
import { DrillCount } from "./DrillCount";

/** A finding's failing records in Fix work, in the run that found them. */
const findingRecords = (f: Finding) => fixHref({ run: f.version_id, module: f.module, check: f.check_id });

/**
 * Fix first of the current state: each object's findings from its own current run only (a finding of an older run
 * of the same object is dropped), in the order given (highest impact first), at most `limit`.
 */
export function currentFixFirst(findings: readonly Finding[], objects: readonly StateObject[], modules: ReadonlySet<string> | null, limit: number): Finding[] {
  const runOf = new Map(objects.map((o) => [o.module, o.run.id]));
  return findings.filter((f) => (!modules || modules.has(f.module)) && f.version_id === runOf.get(f.module)).slice(0, limit);
}

/**
 * A finding's rule in words: its stored message, else the rule's name from the catalogue (DDIC conformance checks,
 * which the catalogue does not hold, named from their id), else the kind of check; the check id sits under them.
 */
function RuleWordsCell({ finding: f }: { finding: Finding }) {
  const message = f.details?.message || null;
  const nameOf = useRuleNames(!message);
  const words = message || nameOf(f.check_id) || (f.check_class ? checkClassLabel(f.check_class) : null);
  return (
    <span className="flex flex-col [min-width:14rem]">
      {words ? <span className="line-clamp-2" title={words}>{words}</span> : null}
      <span className={words ? "m-text-meta m-ink-3" : undefined}>
        <DrillCount href={findingRecords(f)} label={drillLabel({ what: "failing records", check: f.check_id, module: f.module })}><Mono>{f.check_id}</Mono></DrillCount>
      </span>
    </span>
  );
}

/** The Fix first ledger's columns over current-state findings (Insights overview and executive summary). */
export const currentFindingColumns: ColumnDef<Finding>[] = [
  {
    accessorKey: "check_id", header: "Rule",
    // Plain words first (the finding's message, else the rule's name, else the kind of check), the check id under them.
    cell: ({ row }) => <RuleWordsCell finding={row.original} />,
  },
  {
    id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module),
    cell: ({ row }) => <DrillCount href={fixHref({ run: row.original.version_id, module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount>,
  },
  { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  { accessorKey: "affected_count", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => (
    <DrillCount href={findingRecords(row.original)} count={row.original.affected_count} label={drillLabel({ count: row.original.affected_count, what: "failing records", check: row.original.check_id, module: row.original.module })}>{row.original.affected_count.toLocaleString()}</DrillCount>
  ) },
  {
    id: "action", header: "", enableSorting: false,
    cell: ({ row }) => (
      <Link href={buildDrillHref({ object: row.original.module, ruleId: row.original.check_id, run: row.original.version_id })} onClick={(e) => e.stopPropagation()} aria-label={`Open rule ${row.original.check_id} on ${formatModuleName(row.original.module)}`} className="m-ink-accent underline underline-offset-2">Open</Link>
    ),
  },
];

