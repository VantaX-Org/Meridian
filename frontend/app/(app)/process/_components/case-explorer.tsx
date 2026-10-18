"use client";

/**
 * Cases tab (process-discovery spec §7.3, export_process only): case list and the
 * event timeline of `?case=` in a Drawer.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Mono, Notice, Pill, Skeleton } from "@/design";
import { getCaseEvents, listCases, type CaseRow, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { fmtCount } from "./shared";

const COLUMNS: ColumnDef<CaseRow>[] = [
  { accessorKey: "case_id", header: "Case", cell: ({ row }) => <Mono>{row.original.case_id}</Mono> },
  { accessorKey: "first_ts", header: "First event", cell: ({ row }) => formatDate(row.original.first_ts, "datetime") },
  { accessorKey: "last_ts", header: "Last event", cell: ({ row }) => formatDate(row.original.last_ts, "datetime") },
  { accessorKey: "events", header: "Events", cell: ({ row }) => fmtCount(row.original.events) },
];

export function CaseExplorer({ runId, filters, caseId, onOpenCase, onClearFilters }: {
  runId: string;
  filters: ProcessFilterParams;
  caseId: string | null;
  onOpenCase: (caseId: string | null) => void;
  onClearFilters?: () => void;
}) {
  const params = { ...filters, limit: 200 };
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "cases", params), queryFn: () => listCases(runId, params) });
  return (
    <>
      {q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />
        : !q.data ? <Skeleton height={320} />
        : !q.data.items.length ? <EmptyState title="No cases in this view" detail="Widen the filters to include more cases."
          action={onClearFilters && <Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>} />
        : (
          <div className="grid gap-2">
            {q.data.total > q.data.items.length && (
              <p className="m-ink-3">
                Showing the first {fmtCount(q.data.items.length)} of {fmtCount(q.data.total)} cases. Narrow the filters to find one.
              </p>
            )}
            <DataTable columns={COLUMNS} data={q.data.items} getRowId={(c) => c.case_id} onRowClick={(c) => onOpenCase(c.case_id)}
              height="auto" dense tableId="process-cases" exportName={`process-cases-${runId}`} />
          </div>
        )}
      <CaseDrawer runId={runId} filters={filters} caseId={caseId} onClose={() => onOpenCase(null)} />
    </>
  );
}

function CaseDrawer({ runId, filters, caseId, onClose }: {
  runId: string; filters: ProcessFilterParams; caseId: string | null; onClose: () => void;
}) {
  const q = useQuery({
    queryKey: queryKeys.processRunView(runId, "case", { ...filters, caseId }),
    queryFn: () => getCaseEvents(runId, caseId!, filters),
    enabled: !!caseId,
  });
  const events = q.data?.events ?? [];
  return (
    <Drawer open={!!caseId} onOpenChange={(o) => !o && onClose()} title="Case timeline" subtitle={caseId ? <Mono>{caseId}</Mono> : undefined}>
      {q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />
        : !q.data ? <Skeleton height={240} />
        : (
          <div className="grid gap-3">
            {events.some((e) => e.ts_precision === "day") && (
              <Notice tone="info" title="Some steps carry a date only">
                Their source table stores no time, so steps on the same day keep their table order.
              </Notice>
            )}
            <ol className="grid gap-3">
              {events.map((e) => (
                <li key={e.seq} className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{e.activity}</strong>
                    {e.automated === true && <Pill tone="info">Automated</Pill>}
                  </span>
                  <span className="m-text-meta m-ink-3">
                    {formatDate(e.ts, "datetime")}{e.resource ? `, ${e.resource}` : ""}{e.doc_type ? `, document type ${e.doc_type}` : ""}
                  </span>
                  {e.object_refs && (
                    <span className="flex flex-wrap gap-2">
                      {Object.entries(e.object_refs).map(([k, v]) => <Mono key={k}>{`${k} ${v}`}</Mono>)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
    </Drawer>
  );
}
