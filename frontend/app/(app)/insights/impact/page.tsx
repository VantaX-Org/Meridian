// frontend/app/(app)/insights/impact/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { chartSummary, DataTable, DrillLink, EmptyState, ErrorState, Card, Mono, Pareto, Pill, Skeleton, Stat } from "@/design";
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
import { labelOf } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { CardSkeleton, InsightFrame, formatMoney, statusTone, useRunLabel } from "../_components/InsightFrame";

/** Real route for a single check/rule, independent of any module context —
 * unlike `/objects/[object]`, this resolves from the check id alone. */
function ruleHref(checkId: string): string {
  return `/rules/${encodeURIComponent(checkId)}`;
}

function CheckChips({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Link key={id} href={ruleHref(id)}>
          <Pill>
            <Mono>{id}</Mono>
          </Pill>
        </Link>
      ))}
    </div>
  );
}

const impactColumns: ColumnDef<ImpactRow>[] = [
  {
    accessorKey: "feature",
    header: "Feature",
    cell: ({ row }) => (
      <DrillLink object={row.original.feature}>
        {row.original.feature}
      </DrillLink>
    ),
  },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill> },
  {
    accessorKey: "record_count",
    header: "Blocked records",
    cell: ({ row }) => <DrillLink object={row.original.feature}>{row.original.record_count.toLocaleString()}</DrillLink>,
  },
  {
    accessorKey: "value_at_risk",
    header: "Value at risk",
    cell: ({ row }) => row.original.value_at_risk.toLocaleString(),
  },
  {
    id: "causing_rules",
    header: "Blocking rule",
    cell: ({ row }) => <CheckChips ids={row.original.causing_rules} />,
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

const provenCostColumns: ColumnDef<ProvenCostRow>[] = [
  { accessorKey: "label", header: "Metric" },
  { accessorKey: "documents", header: "Documents" },
  { id: "amount", header: "Proven amount", cell: ({ row }) => formatRowAmount(row.original) },
  {
    id: "check_ids",
    header: "Linked checks",
    cell: ({ row }) => <CheckChips ids={row.original.check_ids} />,
  },
];

/** Each insight query renders its own loading/error/empty state, so one query
 * failing or still loading never hides the other section's data. */
function ProvenCostPanel({ query }: { query: UseQueryResult<ProvenCostResponse, Error> }) {
  if (query.isLoading) return <Skeleton height={120} />;
  if (isListFailure(query)) {
    return (
      <ErrorState
        message={apiErrorMessage(query.error)}
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
      <div className="flex gap-6">
        <Stat
          label="Largest L1 proven cost"
          help="provenCost"
          value={topCost ? formatMoney(topCost.amount, currency) : "—"}
          hint={topCost ? `${l1Label(topCost.l1)}, across ${topCost.processes} ${topCost.processes === 1 ? "process" : "processes"}` : undefined}
        />
        <Stat
          label="Largest L1 at risk"
          value={topRisk ? formatMoney(topRisk.value_at_risk, currency) : "—"}
          hint={topRisk ? `${l1Label(topRisk.l1)}, across ${topRisk.processes} ${topRisk.processes === 1 ? "process" : "processes"}` : undefined}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No proven cost findings yet" detail="Proven cost appears once a run finds posted documents that break a rule." action={<Link href="/rules">Open rules</Link>} />
      ) : (
        <DataTable
          columns={provenCostColumns}
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
}: {
  query: UseQueryResult<ImpactResponse, Error>;
  dayOne: ReturnType<typeof useDayOne>;
}) {
  if (query.isLoading || dayOne.status === "loading") return <Skeleton height={160} />;
  if (isListFailure(query)) {
    return (
      <ErrorState
        message={apiErrorMessage(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = query.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No impact results yet"
        detail={dayOne.step?.detail ?? "Impact builds up once a run has blocked or degraded features."}
        action={<DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />}
      />
    );
  }
  return <DataTable columns={impactColumns} data={rows} getRowId={(row) => row.feature} hideToolbar dense height="auto" />;
}

export default function ImpactPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;
  const dayOne = useDayOne();

  const impactQuery = useQuery({
    queryKey: queryKeys.insights("impact", run),
    queryFn: () => getImpact({ version_id: run }),
  });
  const provenCostQuery = useQuery({
    queryKey: queryKeys.insights("proven-cost", run),
    queryFn: () => getProvenCost({ version_id: run }),
  });

  const runLabel = useRunLabel(impactQuery.data?.version_id);
  const rows = impactQuery.data?.rows ?? [];
  const top = [...rows].sort((x, y) => y.value_at_risk - x.value_at_risk)[0];
  const currency = provenCostQuery.data?.currency;
  const byFeature = rows.map((r) => ({ x: labelOf(r.feature), y: r.value_at_risk, domain: domainOf(r.feature) }));

  const loading = impactQuery.isLoading || dayOne.status === "loading";
  const state: "loading" | undefined = loading ? "loading" : undefined;

  return (
    <InsightFrame
      title="Value at risk"
      meta={runLabel}
      state={state}
      skeleton={
        <>
          <CardSkeleton height={240} />
          <CardSkeleton height={160} />
          <CardSkeleton height={200} />
        </>
      }
      insight={impactQuery.isError ? undefined : {
        situation: {
          sentence: top ? `${formatMoney(top.value_at_risk, currency)} at risk in ${labelOf(top.feature)}, the largest of ${rows.length} blocked features` : "No feature carries value at risk",
          tone: rows.length ? "at-risk" : "go",
        },
        changed: { sentence: provenCostQuery.data ? `${provenCostQuery.data.rows.length} proven cost metrics found` : "—" },
        why: { sentence: "Value at risk is the blocked record count times the value per record" },
        next: top
          ? { sentence: `Fix the rules behind ${labelOf(top.feature)}`, action: { label: "Open rules", href: "/rules" } }
          : { sentence: "Run an analysis", action: { label: "Open runs", href: "/runs" } },
      }}
    >
      {rows.length > 0 && (
        <Card title="Cost by feature">
          <div role="img" aria-label={chartSummary(byFeature, "Value at risk by feature")}><Pareto data={byFeature} /></div>
        </Card>
      )}
      <Card title="Proven cost findings">
        <ProvenCostPanel query={provenCostQuery} />
      </Card>
      <Card title="Features at risk">
        <ImpactPanel query={impactQuery} dayOne={dayOne} />
      </Card>
    </InsightFrame>
  );
}
