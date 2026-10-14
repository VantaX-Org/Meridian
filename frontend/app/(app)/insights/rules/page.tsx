"use client";

/** Insights > Explore: one failing-rule set, pivoted by rule, object, field, dimension, severity or S/4 status. */

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, Mono, PageHeader, Pareto, Pill, Select, type PillTone } from "@/design";
import { FilterChips } from "@/app/(app)/objects/_header";
import { getRuleRanking, type RuleRow } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { rulesFor80 } from "../_components/rulesFor80";
import { useFindingOpener } from "../_components/FindingOpener";
import { ruleColumns } from "../_components/RuleColumns";
import { InsightActions } from "../_components/InsightActions";
import { InsightTabs } from "../_components/InsightViews";
import { SavedViews } from "../_components/SavedViews";
import { useInsightScope, withScope } from "../_components/useInsightScope";

const ANY = "any";
const SEVERITIES = ["critical", "high", "medium", "low"];
type Axis = "rule" | "module" | "field" | "dimension" | "severity" | "s4";
const AXES: { value: Axis; label: string }[] = [
  { value: "rule", label: "Rule" }, { value: "module", label: "Object" }, { value: "field", label: "Field" },
  { value: "dimension", label: "Dimension" }, { value: "severity", label: "Severity" }, { value: "s4", label: "S/4 status" },
];
const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "at-risk", medium: "at-risk" };
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
interface Group { key: string; rules: number; affected: number; impact: number; autoFix: number; worst: string | null }
function groupBy(rows: RuleRow[], axis: Axis): Group[] {
  const map = new Map<string, Group & { weighted: number }>();
  for (const r of rows) {
    const key = axis === "module" ? r.module : axis === "field" ? (r.field ?? "No field") : axis === "dimension" ? (r.dimension ?? "unknown") : axis === "severity" ? (r.severity ?? "unknown") : r.s4;
    const g = map.get(key) ?? { key, rules: 0, affected: 0, impact: 0, autoFix: 0, worst: null, weighted: 0 };
    g.rules += 1; g.affected += r.affected; g.impact += r.impact; g.weighted += r.auto_fix_pct * r.affected;
    if (r.severity && (g.worst === null || (SEVERITY_RANK[r.severity] ?? 9) < (SEVERITY_RANK[g.worst] ?? 9))) g.worst = r.severity;
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({ ...g, autoFix: g.affected ? g.weighted / g.affected : 0 })).sort((a, b) => b.impact - a.impact);
}
const DIMENSIONS = ["completeness", "validity", "uniqueness", "consistency", "timeliness", "accuracy"];

export default function RulesPage() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const field = search.get("field") ?? undefined;
  const axisParam = search.get("axis") as Axis | null;
  const axis: Axis = axisParam && AXES.some((a) => a.value === axisParam) ? axisParam : "rule";
  const { run, module, versions, resolving } = useInsightScope();
  const finding = useFindingOpener(run);
  // Every filter lives in the URL (design rule 9), so a view can be saved, shared and restored.
  const severity = search.get("severity") ?? ANY;
  const dimension = search.get("dimension") ?? ANY;
  const auto = search.get("auto") ?? ANY;
  const s4 = search.get("s4") ?? ANY;
  const filters: Record<string, string | undefined> = {
    module, field, axis: axis === "rule" ? undefined : axis,
    severity: severity === ANY ? undefined : severity, dimension: dimension === ANY ? undefined : dimension,
    auto: auto === "yes" ? "yes" : undefined, s4: s4 === "yes" ? "yes" : undefined,
  };
  const go = (next: Record<string, string | undefined>) => router.replace(withScope(path, { run, ...filters, ...next }));
  const setSeverity = (v: string) => go({ severity: v === ANY ? undefined : v });
  const setDimension = (v: string) => go({ dimension: v === ANY ? undefined : v });
  const setAuto = (v: string) => go({ auto: v === ANY ? undefined : v });
  const setS4 = (v: string) => go({ s4: v === ANY ? undefined : v });

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
  const groups = useMemo(() => (axis === "rule" ? [] : groupBy(rows, axis)), [rows, axis]);
  const groupLabel = (key: string) => (axis === "module" ? formatModuleName(key) : axis === "field" ? key : labelOf(key));
  const pareto = axis === "rule" ? rows.slice(0, 20).map((r) => ({ x: r.check_id, y: r.impact })) : groups.slice(0, 20).map((g) => ({ x: groupLabel(g.key), y: g.impact }));
  const n80 = rulesFor80((axis === "rule" ? rows : groups).map((r) => r.impact));
  const setAxis = (next: Axis | null) => go({ axis: next && next !== "rule" ? next : undefined });
  const drill = (g: Group) => {
    const back = { axis: undefined };
    if (axis === "module") go({ ...back, module: g.key });
    else if (axis === "field") go({ ...back, field: g.key === "No field" ? undefined : g.key });
    else if (axis === "dimension") go({ ...back, dimension: g.key });
    else if (axis === "severity") go({ ...back, severity: g.key });
    else go({ ...back, s4: g.key === "blocking" ? "yes" : undefined });
  };
  const groupColumns = useMemo<ColumnDef<Group>[]>(() => [
    { accessorKey: "key", header: AXES.find((a) => a.value === axis)?.label ?? "Group", cell: ({ row }) => (axis === "field" ? <Mono>{row.original.key}</Mono> : groupLabel(row.original.key)) },
    { accessorKey: "rules", header: "Rules", meta: { numeric: true } },
    { accessorKey: "affected", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => row.original.affected.toLocaleString() },
    { accessorKey: "impact", header: "Impact", meta: { numeric: true }, cell: ({ row }) => row.original.impact.toLocaleString() },
    { accessorKey: "autoFix", header: "Auto-fix", meta: { numeric: true }, cell: ({ row }) => `${Math.round(row.original.autoFix)}%` },
    { accessorKey: "worst", header: "Worst severity", cell: ({ row }) => (row.original.worst ? <Pill tone={SEVERITY_TONE[row.original.worst] ?? "neutral"} variant="solid">{labelOf(row.original.worst)}</Pill> : "—") },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [axis]);
  const columns = useMemo<ColumnDef<RuleRow>[]>(() => [
    ...ruleColumns(run),
    {
      id: "records", header: "Records", enableSorting: false,
      cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}/records`, { run, check_id: row.original.check_id })} className="underline-offset-2 hover:underline">Open records</Link>,
    },
  ], [run]);

  const opts = (xs: string[], any: string) => [{ value: ANY, label: any }, ...xs.map((x) => ({ value: x, label: labelOf(x) }))];
  const yesNo = (any: string) => [{ value: ANY, label: any }, { value: "yes", label: "Only these" }];

  return (
    <ExplorerPage
      header={<PageHeader title="Explore" meta={`${module ? formatModuleName(module) : "All objects"}${field ? `, field ${field}` : ""}`} actions={<InsightActions run={run} module={module} />} tabs={<InsightTabs />} />}
      filterBar={
        <div className="flex flex-col gap-2">
        <FilterChips label="Group by" value={axis} options={AXES} onChange={setAxis} />
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Severity" value={severity} onValueChange={setSeverity} options={opts(SEVERITIES, "Any severity")} />
          <Select label="Dimension" value={dimension} onValueChange={setDimension} options={opts(DIMENSIONS, "Any dimension")} />
          <Select label="Auto-fixable" value={auto} onValueChange={setAuto} options={yesNo("Any fix type")} />
          <Select label="S/4 blocking" value={s4} onValueChange={setS4} options={yesNo("Any S/4 status")} />
          {field && <Button variant="secondary" onClick={() => go({ field: undefined })}>Clear field filter</Button>}
          {module && <Button variant="secondary" onClick={() => go({ module: undefined })}>All objects</Button>}
          <SavedViews route="/insights/rules" current={filters} onApply={(f) => router.replace(withScope(path, { run, ...f }))} />
        </div>
        </div>
      }
      summary={
        pareto.length > 0 ? (
          <Card title={`Impact by ${(AXES.find((a) => a.value === axis)?.label ?? "rule").toLowerCase()}`} meta={axis === "rule" ? `${n80} ${n80 === 1 ? "rule accounts" : "rules account"} for 80 % of impact` : `${n80} of ${groups.length} account for 80 % of impact`}>
            <Pareto data={pareto} label={`Impact by ${axis}, top 20`} height={220} />
          </Card>
        ) : undefined
      }
      table={axis === "rule"
        ? <DataTable columns={columns} data={rows} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} dense />
        : <DataTable columns={groupColumns} data={groups} getRowId={(g) => g.key} onRowClick={drill} dense />}
      state={resolving || q.isLoading || versions.isLoading ? "loading" : isListFailure(q) ? "error" : !run || rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No failing rules", detail: "Nothing matches these filters in this run.", ghost: "table" }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      drawer={finding.drawer}
    />
  );
}
