// frontend/app/(app)/mdm/golden/merge/page.tsx
"use client";

// ponytail: no legacy merge page exists to port (confirmed absent on disk in
// Task 20 Step 1 — see task-20-report.md). This is a fresh field-by-field
// conflict view built from getMasterRecord's golden_fields/source_contributions,
// since that's the only merge-relevant data the brief's named API wrappers expose.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, DataTable, EmptyState, ErrorState, Mono, PageHeader, Skeleton } from "@/design";
import type { ColumnDef } from "@tanstack/react-table";
import { getMasterRecord } from "@/lib/api/master-records";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

export default function GoldenRecordMergePage() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";

  const query = useQuery({
    queryKey: queryKeys.masterRecord(id),
    queryFn: () => getMasterRecord(id),
    enabled: !!id,
  });

  if (!id) {
    return (
      <EmptyState
        title="Choose a master record"
        detail="Pick a record from merge candidates to compare its sources."
        action={<Link href="/insights/duplicates" style={{ color: "var(--m-accent)" }}>Review merge candidates</Link>}
      />
    );
  }
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="p-6">
        <ErrorState
          message={apiErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  const record = query.data;
  if (!record) {
    return (
      <EmptyState
        title="Record not found"
        detail="It may have been removed or merged already."
        action={<Link href="/mdm/golden" style={{ color: "var(--m-accent)" }}>All golden records</Link>}
      />
    );
  }

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);

  const rows = fields.map(([field, value]) => ({ field, value }));
  const cols: ColumnDef<{ field: string; value: unknown }>[] = [
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "golden", header: "Golden value", accessorFn: (r) => (r.value == null ? "None" : String(r.value)) },
    ...sources.map(([system, s]): ColumnDef<{ field: string; value: unknown }> => ({
      id: `src-${system}`,
      header: () => <Mono>{system}</Mono>,
      cell: ({ row }) => {
        const c = s as { value: unknown; confidence: number };
        const conflicts = c.value !== row.original.value;
        return (
          <span style={conflicts ? { color: "var(--m-critical)" } : undefined}>
            {c.value == null ? "None" : String(c.value)} ({Math.round(c.confidence * 100)}%)
          </span>
        );
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title={`Merge conflicts for ${record.sap_object_key}`}
        meta="Field-by-field comparison of the golden value against every contributing source"
        actions={<Link href={`/mdm/golden/${record.id}`} className="m-text-body" style={{ color: "var(--m-accent)" }}>Back to record</Link>}
      />
      <Card title="Field comparison" meta={String(fields.length)}>
        {fields.length === 0 ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No golden fields to compare</p>
        ) : (
          <DataTable columns={cols} getRowId={(r) => r.field} data={rows} height="auto" />
        )}
      </Card>
      <Link href="/insights/duplicates" className="m-text-body" style={{ color: "var(--m-accent)" }}>
        Review other merge candidates in duplicates
      </Link>
    </div>
  );
}
