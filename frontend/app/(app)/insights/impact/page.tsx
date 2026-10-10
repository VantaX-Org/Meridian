// frontend/app/(app)/insights/impact/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, Pill, ReportPage, Skeleton, Stat } from "@/design";
import {
  getImpact,
  getProvenCost,
  type ImpactResponse,
  type ImpactRow,
  type ProvenCostItem,
  type ProvenCostResponse,
  type ProvenCostRow,
} from "@/lib/api/insights";
import { queryKeys } from "@/lib/query-keys";

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
  { accessorKey: "feature", header: "Feature" },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "record_count", header: "Blocked records" },
  {
    accessorKey: "value_at_risk",
    header: "Value at risk",
    cell: ({ row }) => row.original.value_at_risk.toLocaleString(),
  },
  {
    id: "causing_rules",
    header: "Causing rules",
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Each insight query renders its own loading/error/empty state, so one query
 * failing or still loading never hides the other section's data. */
function ProvenCostPanel({ query }: { query: UseQueryResult<ProvenCostResponse, Error> }) {
  if (query.isLoading) return <Skeleton height={120} />;
  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(query.error, "Couldn't load proven cost. Try again.")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = query.data?.rows ?? [];
  const currency = query.data?.currency ?? "";
  const total = query.data?.total ?? 0;
  const valueAtRiskTotal = query.data?.value_at_risk_total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-6">
        <Stat label="Proven cost" value={`${total.toLocaleString()} ${currency}`.trim()} />
        <Stat label="Value at risk" value={`${valueAtRiskTotal.toLocaleString()} ${currency}`.trim()} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No proven cost findings for this run yet." />
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

function ImpactPanel({ query }: { query: UseQueryResult<ImpactResponse, Error> }) {
  if (query.isLoading) return <Skeleton height={240} />;
  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(query.error, "Couldn't load feature impact. Try again.")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = query.data?.rows ?? [];
  if (rows.length === 0) {
    return <EmptyState title="No blocked or degraded features for this run yet." />;
  }
  return <DataTable columns={impactColumns} data={rows} getRowId={(row) => row.feature} />;
}

export default function ImpactPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;

  const impactQuery = useQuery({
    queryKey: queryKeys.insights("impact", run),
    queryFn: () => getImpact({ version_id: run }),
  });
  const provenCostQuery = useQuery({
    queryKey: queryKeys.insights("proven-cost", run),
    queryFn: () => getProvenCost({ version_id: run }),
  });

  return (
    <ReportPage
      narrative="value_at_risk = record_count × value_per_record"
      charts={null}
      tables={
        <div className="flex flex-col gap-8">
          <ProvenCostPanel query={provenCostQuery} />
          <ImpactPanel query={impactQuery} />
        </div>
      }
    />
  );
}
