// frontend/app/(app)/insights/impact/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, Mono, Pill, ReportPage, Stat } from "@/design";
import { getImpact, getProvenCost, type ImpactRow, type ProvenCostItem, type ProvenCostRow } from "@/lib/api/insights";
import { queryKeys } from "@/lib/query-keys";

const impactColumns: ColumnDef<ImpactRow>[] = [
  {
    accessorKey: "feature",
    header: "Feature",
    cell: ({ row }) => (
      <DrillLink object={row.original.feature} filters={{ causing_rules: row.original.causing_rules.join(",") }}>
        {row.original.feature}
      </DrillLink>
    ),
  },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "record_count", header: "Blocked records" },
  {
    accessorKey: "value_at_risk",
    header: "Value at risk",
    cell: ({ row }) => row.original.value_at_risk.toLocaleString(),
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
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.check_ids.map((checkId) => (
          <DrillLink key={checkId} object={row.original.metric} filters={{ check_ids: checkId }}>
            <Pill>
              <Mono>{checkId}</Mono>
            </Pill>
          </DrillLink>
        ))}
      </div>
    ),
  },
];

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

  const rows = impactQuery.data?.rows ?? [];
  const provenCostRows = provenCostQuery.data?.rows ?? [];

  const isLoading = impactQuery.isLoading || provenCostQuery.isLoading;
  const isError = impactQuery.isError || provenCostQuery.isError;
  const error = impactQuery.error ?? provenCostQuery.error;
  const isEmpty = rows.length === 0 && provenCostRows.length === 0;

  const provenCostTotal = provenCostQuery.data?.total ?? 0;
  const provenCostCurrency = provenCostQuery.data?.currency ?? "";
  const valueAtRiskTotal = provenCostQuery.data?.value_at_risk_total ?? 0;

  return (
    <ReportPage
      narrative="value_at_risk = record_count × value_per_record"
      charts={
        <div className="flex gap-6">
          <Stat label="Proven cost" value={`${provenCostTotal.toLocaleString()} ${provenCostCurrency}`.trim()} />
          <Stat label="Value at risk" value={`${valueAtRiskTotal.toLocaleString()} ${provenCostCurrency}`.trim()} />
        </div>
      }
      tables={
        <div className="flex flex-col gap-6">
          <DataTable
            columns={provenCostColumns}
            data={provenCostRows}
            getRowId={(row) => row.metric}
            renderDrawer={(row) => (
              <DataTable columns={itemColumns} data={row.items} getRowId={(item) => item.doc_key} />
            )}
          />
          <DataTable columns={impactColumns} data={rows} getRowId={(row) => row.feature} />
        </div>
      }
      state={isLoading ? "loading" : isError ? "error" : isEmpty ? "empty" : undefined}
      emptyProps={{ title: "No blocked or degraded features for this run yet." }}
      errorProps={{
        message: error instanceof Error ? error.message : "Couldn't load feature impact. Try again.",
        onRetry: () => {
          void impactQuery.refetch();
          void provenCostQuery.refetch();
        },
      }}
    />
  );
}
