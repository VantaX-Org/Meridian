// frontend/app/(app)/mdm/golden/merge/page.tsx
"use client";

// ponytail: no legacy merge page exists to port (confirmed absent on disk in
// Task 20 Step 1 — see task-20-report.md). This is a fresh field-by-field
// conflict view built from getMasterRecord's golden_fields/source_contributions,
// since that's the only merge-relevant data the brief's named API wrappers expose.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DataTable, EmptyState, ErrorState, Mono, PageHeader, Skeleton, toast } from "@/design";
import type { ColumnDef } from "@tanstack/react-table";
import { LedgerHead } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { getMasterRecord } from "@/lib/api/master-records";
import { setStewardOverrides } from "@/lib/api/merge-explain";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

export default function GoldenRecordMergePage() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const qc = useQueryClient();
  const canResolve = useRole().can("approve");

  const query = useQuery({
    queryKey: queryKeys.masterRecord(id),
    queryFn: () => getMasterRecord(id),
    enabled: !!id,
  });
  // A steward's choice is recorded as an override on the golden record; the merge keeps it on the next build.
  const useValue = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => setStewardOverrides(id, { [field]: value }, "Chosen on the merge conflicts page"),
    onSuccess: (_r, { field }) => { toast.success(`${field} now uses the chosen value`); void qc.invalidateQueries({ queryKey: queryKeys.masterRecord(id) }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const header = <PageHeader title="Merge conflicts" meta="Field-by-field comparison of a golden record against every contributing source" />;
  if (!id) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title="Choose a golden record"
          detail="Open a golden record and choose Compare sources to see where its sources disagree."
          action={<Button render={<Link href="/mdm/golden">Open golden records</Link>} />}
        />
      </div>
    );
  }
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <ErrorState
          {...apiErrorState(query.error)}
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
        action={<Button render={<Link href="/mdm/golden">All golden records</Link>} />}
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
          <span className={`inline-flex items-center gap-2 ${conflicts ? "m-ink-critical" : ""}`}>
            {c.value == null ? "None" : String(c.value)} ({Math.round(c.confidence * 100)}%)
            {conflicts && canResolve && c.value != null ? (
              <Button variant="ghost" size="sm" disabled={useValue.isPending} onClick={() => useValue.mutate({ field: row.original.field, value: String(c.value) })}>
                Use this value
              </Button>
            ) : null}
          </span>
        );
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Merge conflicts for ${record.sap_object_key}`}
        meta="Field-by-field comparison of the golden value against every contributing source"
        actions={<Button variant="secondary" render={<Link href={`/mdm/golden/${record.id}`}>Back to record</Link>} />}
      />
      <section aria-label="Field comparison">
        <LedgerHead title="Field comparison" meta={String(fields.length)} />
        {fields.length === 0 ? (
          <EmptyState
            title="No golden fields to compare"
            detail="This record has no consolidated fields yet."
            action={<Button variant="secondary" render={<Link href={`/mdm/golden/${record.id}`}>Back to record</Link>} />}
          />
        ) : (
          <DataTable columns={cols} getRowId={(r) => r.field} data={rows} height="auto" />
        )}
      </section>
      <div>
        <Button variant="ghost" render={<Link href="/insights/duplicates">Review other duplicate pairs</Link>} />
      </div>
    </div>
  );
}
