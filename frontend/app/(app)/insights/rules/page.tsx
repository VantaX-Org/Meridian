"use client";

/** Insights > Explore: one failing-rule set, pivoted by rule, object, field, dimension, severity or S/4 status. */

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, ErrorState, Mono, Pareto, Select, Skeleton, Status } from "@/design";
import { FilterChips } from "@/app/(app)/objects/_header";
import { getRuleRanking, type RuleRow } from "@/lib/api/insights";
import { getCostModel } from "@/lib/api/settings";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf, plural } from "@/lib/format";
import { drillLabel, fixHref } from "@/lib/drill";
import { queryKeys } from "@/lib/query-keys";
import { DrillCount } from "../_components/DrillCount";
import { rulesFor80 } from "../_components/rulesFor80";
import { useFindingOpener } from "../_components/FindingOpener";
import { ruleColumns } from "../_components/RuleColumns";
import { InsightFrame, formatMoney } from "../_components/InsightFrame";
import { SavedViews } from "../_components/SavedViews";
import { PAGE_PURPOSE } from "../_components/InsightViews";
import { useInsightScope, withScope } from "../_components/useInsightScope";

const ANY = "any";
const SEVERITIES = ["critical", "high", "medium", "low"];
type Axis = "rule" | "module" | "field" | "dimension" | "severity" | "s4";
const AXES: { value: Axis; label: string }[] = [
  { value: "rule", label: "Rule" }, { value: "module", label: "Object" }, { value: "field", label: "Field" },
  { value: "dimension", label: "Dimension" }, { value: "severity", label: "Severity" }, { value: "s4", label: "S/4 status" },
];
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
  /** A group's failing records in Fix work, where Fix work can filter by the axis (object or severity). */
  const groupHref = (key: string): string | undefined =>
    axis === "module" ? fixHref({ run, module: key }) : axis === "severity" && SEVERITIES.includes(key) ? fixHref({ run, module, sev: key }) : undefined;
  const groupDrillLabel = (g: Group, count?: number) =>
    axis === "module" ? drillLabel({ count, what: "failing records", module: g.key }) : drillLabel({ count, sev: g.key, what: "failing records", module });
  const pareto = axis === "rule"
    ? rows.slice(0, 20).map((r) => ({ x: r.check_id, y: r.impact, object: r.module, ruleId: r.check_id }))
    : groups.slice(0, 20).map((g) => ({ x: groupLabel(g.key), y: g.impact, dimension: g.key }));
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
    { accessorKey: "key", header: AXES.find((a) => a.value === axis)?.label ?? "Group", cell: ({ row }) => (
      axis === "field" ? <Mono>{row.original.key}</Mono>
        : <DrillCount href={groupHref(row.original.key)} label={groupDrillLabel(row.original)}>{groupLabel(row.original.key)}</DrillCount>
    ) },
    { accessorKey: "rules", header: "Rules", meta: { numeric: true } },
    // Field, dimension and S/4 groups have no Fix work filter: their row narrows this page instead.
    { accessorKey: "affected", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => (
      <DrillCount href={groupHref(row.original.key)} count={row.original.affected} label={groupDrillLabel(row.original, row.original.affected)}>{row.original.affected.toLocaleString()}</DrillCount>
    ) },
    { accessorKey: "impact", header: "Impact on score", meta: { numeric: true }, cell: ({ row }) => row.original.impact.toLocaleString() },
    { accessorKey: "autoFix", header: "Auto-fixable", meta: { numeric: true }, cell: ({ row }) => `${Math.round(row.original.autoFix)}%` },
    { accessorKey: "worst", header: "Worst severity", cell: ({ row }) => (row.original.worst ? <Status kind="severity" value={row.original.worst} variant="solid" /> : "—") },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [axis, run, module]);
  // Cost at risk is in the tenant currency (cost model); the column appears once any rule carries a cost.
  const costModel = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel, retry: false, meta: { ignoreError: true }, staleTime: 300_000 });
  const currency = costModel.data?.currency;
  const hasCost = rows.some((r) => r.cost_at_risk != null && r.cost_at_risk > 0);
  const columns = useMemo<ColumnDef<RuleRow>[]>(() => [
    ...ruleColumns(run),
    { id: "field", header: "Field", accessorFn: (r) => r.field ?? "", cell: ({ row }) => (row.original.field ? <Mono>{row.original.field}</Mono> : "—") },
    ...(hasCost ? [{
      id: "cost", header: currency ? `Cost at risk (${currency})` : "Cost at risk", meta: { numeric: true }, accessorFn: (r: RuleRow) => r.cost_at_risk ?? 0,
      cell: ({ row }: { row: { original: RuleRow } }) => (row.original.cost_at_risk ? formatMoney(row.original.cost_at_risk, currency) : "—"),
    } satisfies ColumnDef<RuleRow>] : []),
    {
      id: "records", header: "Records", enableSorting: false,
      // The rule's failing records in Fix work.
      cell: ({ row }) => (
        <Link
          href={fixHref({ run, module: row.original.module, check: row.original.check_id })}
          aria-label={drillLabel({ count: row.original.affected, what: "failing records", check: row.original.check_id, module: row.original.module })}
          onClick={(e) => e.stopPropagation()}
          className="underline-offset-2 hover:underline"
        >Open records</Link>
      ),
    },
  ], [run, hasCost, currency]);

  const opts = (xs: string[], any: string) => [{ value: ANY, label: any }, ...xs.map((x) => ({ value: x, label: labelOf(x) }))];
  const yesNo = (any: string) => [{ value: ANY, label: any }, { value: "yes", label: "Only these" }];
  const axisLabel = AXES.find((a) => a.value === axis)?.label ?? "Rule";
  // "Impact by S/4 status" keeps the product name's case; every other axis reads in lower case.
  const axisInTitle = axis === "s4" ? axisLabel : axisLabel.toLowerCase();
  const state = resolving || q.isLoading || versions.isLoading ? "loading" : isListFailure(q) ? "error" : undefined;
  const top = rows[0];
  const hasFilters = Object.entries(filters).some(([k, v]) => k !== "axis" && !!v);
  const totalAffected = rows.reduce((n, r) => n + r.affected, 0);
  const blocking = rows.filter((r) => r.s4 === "blocking").length;

  return (
    <InsightFrame
      title="Failing rules"
      purpose={PAGE_PURPOSE["/insights/rules"]}
      scope
      meta={<>{module ? formatModuleName(module) : "Every object in this run"}{field ? <>, field <Mono>{field}</Mono></> : null}</>}
      run={run}
      module={module}
      insight={{
        situation: { sentence: rows.length ? `${plural(rows.length, "rule fails", "rules fail")} on ${plural(totalAffected, "record")} in this scope` : "No rule fails in this scope", tone: blocking ? "no-go" : rows.length ? "at-risk" : "go" },
        changed: { sentence: rows.length ? `${plural(n80, "rule accounts", "rules account")} for 80% of the impact on the score` : "Nothing to rank" },
        why: { sentence: blocking ? `${plural(blocking, "rule")} would block an S/4 load` : "No failing rule blocks an S/4 load", href: withScope("/insights/readiness", { run }) },
        next: top
          ? { sentence: `Start with ${top.name || top.check_id}, the highest impact`, action: { label: "Open the rule", onClick: () => void finding.open(top) } }
          : hasFilters
            ? { sentence: "Clear the filters to see every failing rule", action: { label: "Clear filters", href: withScope("/insights/rules", { run }) } }
            : { sentence: "Nothing fails here; pick another run", action: { label: "Open runs", href: "/runs" } },
      }}
      state={state}
      skeleton={<><Skeleton height={220} /><Skeleton height={320} /></>}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
    >
      <div className="flex flex-col gap-2">
        <FilterChips label="Group by" value={axis} options={AXES} onChange={setAxis} />
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Severity" value={severity} onValueChange={setSeverity} options={opts(SEVERITIES, "Any severity")} />
          <Select label="Dimension" value={dimension} onValueChange={setDimension} options={opts(DIMENSIONS, "Any dimension")} />
          <Select label="Auto-fixable" value={auto} onValueChange={setAuto} options={yesNo("Any fix type")} />
          <Select label="Blocks an S/4 load" value={s4} onValueChange={setS4} options={yesNo("Any S/4 status")} />
          {field && <Button variant="secondary" onClick={() => go({ field: undefined })}>Clear field filter</Button>}
          {module && <Button variant="secondary" onClick={() => go({ module: undefined })}>Every object in this run</Button>}
          <SavedViews route="/insights/rules" current={filters} onApply={(f) => router.replace(withScope(path, { run, ...f }))} />
        </div>
      </div>
      {!run || rows.length === 0 ? (
        q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />
          : !run
            ? <EmptyState title="No finished run yet" detail="Failing rules are listed once a run has been analysed." ghost="table" action={<Button render={<Link href="/runs">Open runs</Link>} />} />
            : hasFilters
              ? <EmptyState title="No failing rules match" detail="Nothing matches these filters in this run." ghost="table" action={<Button variant="secondary" render={<Link href={withScope("/insights/rules", { run })}>Clear filters</Link>} />} />
              : <EmptyState title="No rule fails in this run" detail="Every rule that ran passed. Open another run to compare." ghost="table" action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />} />
      ) : (
        <>
          {/* The ledger first: the rules (or groups) ranked by impact, the last column the row's one action. */}
          {axis === "rule"
            ? <DataTable columns={columns} data={rows} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} dense />
            : <DataTable columns={groupColumns} data={groups} getRowId={(g) => g.key} onRowClick={drill} dense />}
          {pareto.length > 0 && (
            <Card title={`Impact by ${axisInTitle}`} meta={axis === "rule" ? `${plural(n80, "rule accounts", "rules account")} for 80% of impact` : `${n80} of ${groups.length} ${n80 === 1 ? "accounts" : "account"} for 80% of impact`}>
              <Pareto
                data={pareto}
                label={`Impact by ${axisInTitle}, top 20`}
                height={160}
                onPointClick={(p) => {
                  if (p.ruleId) { router.push(fixHref({ run, module: p.object, check: p.ruleId })); return; }
                  const g = groups.find((x) => x.key === p.dimension);
                  if (!g) return;
                  const href = groupHref(g.key);
                  if (href) router.push(href);
                  else drill(g);
                }}
              />
            </Card>
          )}
        </>
      )}
      {finding.drawer}
    </InsightFrame>
  );
}
