"use client";

/** Insights > Rule ranking: failing rules by impact, with the Pareto of the top 20. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, PageHeader, Pareto, Select } from "@/design";
import { getRuleRanking, type RuleRow } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { rulesFor80 } from "../_components/rulesFor80";
import { useFindingOpener } from "../_components/FindingOpener";
import { ruleColumns } from "../_components/RuleColumns";
import { useInsightScope, withScope } from "../_components/useInsightScope";

const ANY = "any";
const SEVERITIES = ["critical", "high", "medium", "low"];
const DIMENSIONS = ["completeness", "validity", "uniqueness", "consistency", "timeliness", "accuracy"];

export default function RulesPage() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const field = search.get("field") ?? undefined;
  const { run, module, runs, versions, resolving } = useInsightScope();
  const finding = useFindingOpener(run);
  const [severity, setSeverity] = useState(ANY);
  const [dimension, setDimension] = useState(ANY);
  const [auto, setAuto] = useState(ANY);
  const [s4, setS4] = useState(ANY);

  const q = useQuery({
    queryKey: queryKeys.insights("rules", run, module, severity, dimension, auto, s4),
    queryFn: () => getRuleRanking({
      version_id: run, module, limit: 200,
      severity: severity === ANY ? undefined : severity,
      dimension: dimension === ANY ? undefined : dimension,
      auto_fixable: auto === "yes" ? true : undefined,
      s4_only: s4 === "yes" ? true : undefined,
    }),
    enabled: !!run,
  });

  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !field || r.field === field), [q.data, field]);
  const top = rows.slice(0, 20);
  const n80 = rulesFor80(rows.map((r) => r.impact));
  const columns = useMemo<ColumnDef<RuleRow>[]>(() => [
    ...ruleColumns(run),
    {
      id: "records", header: "Records", enableSorting: false,
      cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}/records`, { run, check_id: row.original.check_id })} className="underline-offset-2 hover:underline">Open records</Link>,
    },
  ], [run]);

  const setScope = (id: string) => router.replace(withScope(path, { run: id, module, field }));
  const opts = (xs: string[], any: string) => [{ value: ANY, label: any }, ...xs.map((x) => ({ value: x, label: labelOf(x) }))];
  const yesNo = (any: string) => [{ value: ANY, label: any }, { value: "yes", label: "Only these" }];

  return (
    <ExplorerPage
      header={<PageHeader title="Rule ranking" meta={`${module ? formatModuleName(module) : "All objects"}${field ? `, field ${field}` : ""}`} />}
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Run" value={run ?? ""} onValueChange={setScope} placeholder="Choose a run" options={runs.map((v) => ({ value: v.id, label: v.label || formatDate(v.run_at, "datetime") }))} />
          <Select label="Severity" value={severity} onValueChange={setSeverity} options={opts(SEVERITIES, "Any severity")} />
          <Select label="Dimension" value={dimension} onValueChange={setDimension} options={opts(DIMENSIONS, "Any dimension")} />
          <Select label="Auto-fixable" value={auto} onValueChange={setAuto} options={yesNo("Any fix type")} />
          <Select label="S/4 blocking" value={s4} onValueChange={setS4} options={yesNo("Any S/4 status")} />
          {field && <Button variant="secondary" render={<Link href={withScope(path, { run, module })}>Clear field filter</Link>} />}
        </div>
      }
      summary={
        top.length > 0 ? (
          <Card title="Impact by rule" meta={`${n80} ${n80 === 1 ? "rule accounts" : "rules account"} for 80 % of impact`}>
            <Pareto data={top.map((r) => ({ x: r.check_id, y: r.impact }))} label="Failing rules by impact, top 20" height={220} />
          </Card>
        ) : undefined
      }
      table={<DataTable columns={columns} data={rows} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} dense />}
      state={resolving || q.isLoading || versions.isLoading ? "loading" : isListFailure(q) ? "error" : !run || rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No failing rules", detail: "Nothing matches these filters in this run.", ghost: "table" }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      drawer={finding.drawer}
    />
  );
}
