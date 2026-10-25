// frontend/app/(app)/insights/impact/page.tsx
"use client";

import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, chartSummary, DataTable, EmptyState, ErrorState, Card, Mono, Pareto, Pill, Skeleton, Stat, Status } from "@/design";
import {
  getImpact,
  getProvenCost,
  l1Label,
  largestCost,
  largestValueAtRisk,
  type ImpactResponse,
  type ImpactRow,
  type ProvenCostItem,
  type ProvenCostResponse,
  type ProvenCostRow,
} from "@/lib/api/insights";
import { domainOf } from "@/design/tokens";
import { getCostModel } from "@/lib/api/settings";
import { drillLabel, fixHref } from "@/lib/drill";
import { featureLabel, plural } from "@/lib/format";
import { previousInLineage } from "@/lib/runs";
import { isListFailure, apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { DrillCount } from "../_components/DrillCount";
import { CardSkeleton, InsightFrame, formatMoney } from "../_components/InsightFrame";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";

/**
 * A rule's failing records in Fix work, from the check id alone (an impact row names no object). `/rules/<id>` takes
 * the rules row id, not a check id, so it is not a target here.
 */
function ruleRecordsHref(checkId: string, run?: string): string {
  return fixHref({ run, check: checkId });
}

function CheckChips({ ids, run }: { ids: string[]; run?: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Link key={id} href={ruleRecordsHref(id, run)} aria-label={drillLabel({ what: "failing records", check: id })}>
          <Pill>
            <Mono>{id}</Mono>
          </Pill>
        </Link>
      ))}
    </div>
  );
}

/** Rows with blocked records; a feature with nothing blocked carries no value at risk and is not listed. */
export function impactRows(rows: ImpactRow[]): ImpactRow[] {
  return rows.filter((r) => r.record_count > 0 || r.value_at_risk > 0);
}

const impactColumns = (currency?: string | null, run?: string): ColumnDef<ImpactRow>[] => [
  {
    // An SAP feature (a transaction or capability) is a name, not an object: it has no page of its own to open.
    accessorKey: "feature",
    header: "SAP feature",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{featureLabel(row.original.feature)}</span>
        {row.original.l1 ? <span className="m-text-meta m-ink-3">{l1Label(row.original.l1)}</span> : null}
      </span>
    ),
  },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Status kind="verdict" value={row.original.status} /> },
  {
    accessorKey: "record_count",
    header: "Blocked records",
    meta: { numeric: true },
    // The count opens the failing records of the rule that blocks the feature (the first, when several do); with no
    // rule named it is a plain figure.
    cell: ({ row }) => {
      const [first, ...more] = row.original.causing_rules;
      const label = `${drillLabel({ count: row.original.record_count, what: "blocked records", check: first })} that block ${featureLabel(row.original.feature)}${more.length ? `; ${plural(more.length, "more rule")} in the rules column` : ""}`;
      return <DrillCount href={first ? ruleRecordsHref(first, run) : undefined} count={row.original.record_count} label={label}>{row.original.record_count.toLocaleString()}</DrillCount>;
    },
  },
  {
    accessorKey: "value_at_risk",
    header: currency ? `Value at risk (${currency})` : "Value at risk",
    meta: { numeric: true },
    // A zero is "not priced", never a currency amount of nothing.
    cell: ({ row }) => (row.original.value_at_risk > 0 ? formatMoney(row.original.value_at_risk, currency) : "—"),
  },
  {
    id: "causing_rules",
    header: "Rules behind it",
    cell: ({ row }) => <CheckChips ids={row.original.causing_rules} run={run} />,
  },
  {
    id: "action", header: "", enableSorting: false,
    cell: ({ row }) => (row.original.causing_rules[0]
      ? <Link href={ruleRecordsHref(row.original.causing_rules[0], run)} aria-label={`Open the records that block ${featureLabel(row.original.feature)}`} className="m-ink-accent underline underline-offset-2">Open records</Link>
      : "—"),
  },
];

function formatRowAmount(row: ProvenCostRow): string {
  if (row.currency) return `${row.amount.toLocaleString()} ${row.currency}`;
  return Object.entries(row.by_currency)
    .map(([currency, amount]) => `${amount.toLocaleString()} ${currency}`)
    .join(", ");
}

const itemColumns: ColumnDef<ProvenCostItem>[] = [
  { accessorKey: "doc_key", header: "Document", cell: ({ row }) => <Mono>{row.original.doc_key}</Mono> },
  { accessorKey: "detail", header: "Detail" },
  { accessorKey: "amount", header: "Amount", cell: ({ row }) => row.original.amount.toLocaleString() },
];

const provenCostColumns = (run?: string): ColumnDef<ProvenCostRow>[] => [
  { accessorKey: "label", header: "What it costs" },
  { accessorKey: "documents", header: "Documents", meta: { numeric: true } },
  { id: "amount", header: "Proven amount", meta: { numeric: true }, cell: ({ row }) => formatRowAmount(row.original) },
  {
    id: "check_ids",
    header: "Rules behind it",
    cell: ({ row }) => <CheckChips ids={row.original.check_ids} run={run} />,
  },
];

/** Each insight query renders its own loading/error/empty state, so one query
 * failing or still loading never hides the other section's data. */
function ProvenCostPanel({ query, run }: { query: UseQueryResult<ProvenCostResponse, Error>; run?: string }) {
  if (query.isLoading) return <Skeleton height={120} />;
  if (isListFailure(query)) {
    return (
      <ErrorState
        {...apiErrorState(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = query.data?.rows ?? [];
  const currency = query.data?.currency ?? "";
  const topCost = largestCost(query.data?.cost_by_l1 ?? []);
  const topRisk = largestValueAtRisk(query.data?.value_at_risk_by_l1 ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="m-stat-grid">
        <Stat
          label="Largest proven cost, one process"
          help="provenCost"
          value={topCost ? formatMoney(topCost.amount, currency) : "—"}
          hint={topCost ? `${l1Label(topCost.l1)}, across ${topCost.processes} ${topCost.processes === 1 ? "process" : "processes"}` : undefined}
        />
        <Stat
          label={topRisk ? `Most at risk: ${l1Label(topRisk.l1)}` : "Most at risk"}
          value={topRisk ? formatMoney(topRisk.value_at_risk, currency) : "—"}
          hint={topRisk ? `Across ${topRisk.processes} ${topRisk.processes === 1 ? "process" : "processes"}` : undefined}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No proven cost yet" detail="Proven cost appears once a run finds posted documents that break a rule." action={<Link href="/rules" className="underline-offset-2 hover:underline">Open rules</Link>} />
      ) : (
        <DataTable
          columns={provenCostColumns(run)}
          data={rows}
          getRowId={(row) => row.metric}
          renderDrawer={(row) => (
            <DataTable columns={itemColumns} data={row.items} getRowId={(item) => item.doc_key} />
          )}
        />
      )}
    </div>
  );
}

function ImpactPanel({
  query,
  dayOne,
  currency,
  unpriced,
  run,
}: {
  query: UseQueryResult<ImpactResponse, Error>;
  dayOne: ReturnType<typeof useDayOne>;
  currency?: string | null;
  /** True when the tenant's cost model prices no feature yet, so no value at risk can exist. */
  unpriced: boolean;
  run?: string;
}) {
  if (query.isLoading || dayOne.status === "loading") return <Skeleton height={160} />;
  if (isListFailure(query)) {
    return (
      <ErrorState
        {...apiErrorState(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = impactRows(query.data?.rows ?? []).sort((a, b) => b.value_at_risk - a.value_at_risk || b.record_count - a.record_count);
  if (rows.length === 0) {
    if (unpriced) {
      return (
        <EmptyState
          title="No feature is priced yet"
          detail="Value at risk multiplies blocked records by a value per record. Give each SAP feature a value under Admin, Settings."
          action={<Button render={<Link href="/admin/settings">Open settings</Link>} />}
        />
      );
    }
    return (
      <EmptyState
        title="No impact results yet"
        detail={dayOne.step?.detail ?? "Impact builds up once a run has blocked or degraded features."}
        action={<DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />}
      />
    );
  }
  return <DataTable columns={impactColumns(currency, run)} data={rows} getRowId={(row) => row.feature} hideToolbar height="auto" />;
}

export default function ImpactPage() {
  const { run, runs, resolving, error: listError, refetch: refetchList } = useInsightScope();
  const dayOne = useDayOne();
  // No run because the run list (or the day-one sources) failed: an error, never "No value at risk yet".
  const loadError = run ? null : listError ?? (dayOne.status === "error" ? dayOne.error : null);

  // Both follow the run the header names; they wait for it rather than read whatever run the API thinks is latest.
  const impactQuery = useQuery({
    queryKey: queryKeys.insights("impact", run),
    queryFn: () => getImpact({ version_id: run }),
    enabled: !!run,
  });
  // What changed: the same features at the run before this one in its lineage (same system, or uploads of the same objects).
  const current = runs.find((r) => r.id === run);
  const previous = current ? previousInLineage(current, runs) : null;
  const prevQuery = useQuery({
    queryKey: queryKeys.insights("impact", previous?.id),
    queryFn: () => getImpact({ version_id: previous?.id }),
    enabled: !!previous,
  });
  const provenCostQuery = useQuery({
    queryKey: queryKeys.insights("proven-cost", run),
    queryFn: () => getProvenCost({ version_id: run }),
    enabled: !!run,
  });

  // The cost model says whether any feature is priced; without pricing, zero value at risk is expected, not a finding.
  const costModel = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel, retry: false, meta: { ignoreError: true }, staleTime: 300_000 });
  const unpriced = !!costModel.data && Object.keys(costModel.data.features ?? {}).length === 0;

  const rows = impactRows(impactQuery.data?.rows ?? []);
  const top = [...rows].sort((x, y) => y.value_at_risk - x.value_at_risk)[0];
  const currency = provenCostQuery.data?.currency ?? costModel.data?.currency;
  const byFeature = rows.filter((r) => r.value_at_risk > 0).map((r) => ({ x: featureLabel(r.feature), y: r.value_at_risk, domain: domainOf(r.feature) }));
  const prevRows = impactRows(prevQuery.data?.rows ?? []);
  const atRisk = rows.reduce((n, r) => n + r.value_at_risk, 0);
  const prevAtRisk = prevRows.reduce((n, r) => n + r.value_at_risk, 0);
  const changed = previous && prevQuery.isLoading
    ? <Skeleton height={16} />
    : !previous
      ? "First run of this system"
      : !prevQuery.data
        ? "The previous run could not be read"
        : atRisk !== prevAtRisk
          ? `Value at risk ${atRisk > prevAtRisk ? "up" : "down"} ${formatMoney(Math.abs(atRisk - prevAtRisk), currency)} since the previous run`
          : rows.length === prevRows.length
            ? `${plural(rows.length, "feature")} blocked, as in the previous run`
            : `${Math.abs(rows.length - prevRows.length).toLocaleString()} ${rows.length > prevRows.length ? "more" : "fewer"} features blocked than in the previous run`;

  // Each card follows its own query, so proven cost shows while a large impact query is still running.
  const state: "loading" | "empty" | "error" | undefined = dayOne.status === "loading" || resolving ? "loading" : loadError ? "error" : !run ? "empty" : undefined;

  return (
    <InsightFrame
      title="Value at risk"
      purpose={PAGE_PURPOSE["/insights/impact"]}
      scope
      run={run}
      state={state}
      errorProps={{ error: loadError, onRetry: () => { refetchList(); dayOne.refetch(); } }}
      emptyProps={{
        title: "No value at risk yet",
        detail: dayOne.step?.detail ?? "Value at risk is worked out from a finished run.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      skeleton={
        <>
          <CardSkeleton height={240} />
          <CardSkeleton height={160} />
          <CardSkeleton height={200} />
        </>
      }
      insight={impactQuery.isError ? undefined : {
        loading: impactQuery.isLoading,
        situation: {
          sentence: top && top.value_at_risk > 0
            ? `${formatMoney(top.value_at_risk, currency)} at risk in ${featureLabel(top.feature)}, the largest of ${plural(rows.length, "blocked SAP feature")}`
            : rows.length ? `${plural(rows.length, "feature is", "features are")} blocked, but none is priced yet` : "No feature carries value at risk",
          tone: top && top.value_at_risk > 0 ? "at-risk" : rows.length ? "at-risk" : "go",
        },
        changed: { sentence: changed, href: previous && run ? `/runs/${run}/vs/${previous.id}` : undefined },
        why: { sentence: "Value at risk is what the blocked records are worth: their count times the value of each" },
        next: unpriced
          ? { sentence: "Give each SAP feature a value and the defects get a price", action: { label: "Open settings", href: "/admin/settings" } }
          : top
          ? top.causing_rules[0]
            ? { sentence: `Fix the rule behind ${featureLabel(top.feature)}`, action: { label: "Open its records", href: ruleRecordsHref(top.causing_rules[0], run) } }
            : { sentence: `Fix the rules behind ${featureLabel(top.feature)}`, action: { label: "Open failing rules", href: withScope("/insights/rules", { run }) } }
          : { sentence: "Nothing is blocked; keep the score where it is", action: { label: "Open failing rules", href: withScope("/insights/rules", { run }) } },
      }}
    >
      <Card title="SAP features at risk" meta="Ranked by value at risk: blocked records times the value of each">
        <ImpactPanel query={impactQuery} dayOne={dayOne} currency={currency} unpriced={unpriced} run={run} />
      </Card>
      {byFeature.length > 0 && (
        <Card title="Value at risk by feature" meta="The few features that carry most of it come first">
          <div role="img" aria-label={chartSummary(byFeature, "Value at risk by feature")}><Pareto data={byFeature} height={180} /></div>
        </Card>
      )}
      <Card title="Proven cost" meta="Money already lost in posted documents that break a rule">
        <ProvenCostPanel query={provenCostQuery} run={run} />
      </Card>
    </InsightFrame>
  );
}
