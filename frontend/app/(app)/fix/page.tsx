"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, ExplorerPage, ExportMenu, Mono, PageHeader, Pager, Stat, Tabs, emptyExportOptions, type CellMeta } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadCleaningExport, getCleaningQueue, type CleaningQueueItem } from "@/lib/api/cleaning";
import { ProposalCell, proposalOf, type Proposal } from "@/components/fix/proposal";
import { RuleCell } from "@/components/fix/rule-cell";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { BatchesTab } from "./batches-tab";
import { DedupTab } from "./monitor-dedup-tabs";
import { MonitorTab } from "./monitor-tab";

/** Same threshold as the batch page's "Accept N at 85% or higher". */
const HIGH_CONFIDENCE = 0.85;

/** One ledger row: the proposals one rule made inside one batch, so a row is a decision (review this rule's fixes). */
interface QueueRow {
  id: string;
  batch_id: string;
  object_type: string;
  rule_id: string | null;
  records: number;
  avg_confidence: number;
  status: string;
  /** The most common proposed value of the group, with the field it changes; null when the proposals carry none. */
  proposed: Proposal | null;
}

/** Groups the queue's items by batch and rule: records affected, mean confidence and the typical proposed value. */
function groupIntoRows(items: CleaningQueueItem[]): QueueRow[] {
  const groups = new Map<string, CleaningQueueItem[]>();
  for (const item of items) {
    if (!item.batch_id) continue;
    const key = `${item.batch_id}\u0000${item.rule_id ?? ""}`;
    const rows = groups.get(key);
    if (rows) rows.push(item); else groups.set(key, [item]);
  }
  return [...groups.values()]
    .map((rows): QueueRow => {
      const counts = new Map<string, { n: number; p: Proposal }>();
      for (const r of rows) {
        const p = proposalOf(r);
        if (p) counts.set(p.value, { n: (counts.get(p.value)?.n ?? 0) + 1, p });
      }
      const top = [...counts.values()].sort((x, y) => y.n - x.n)[0];
      return {
        id: `${rows[0].batch_id}/${rows[0].rule_id ?? ""}`,
        batch_id: rows[0].batch_id as string,
        object_type: rows[0].object_type,
        rule_id: rows[0].rule_id,
        records: rows.length,
        avg_confidence: rows.reduce((n, r) => n + r.confidence, 0) / rows.length,
        status: rows.every((r) => r.status === rows[0].status) ? rows[0].status : "mixed",
        proposed: top?.p ?? null,
      };
    })
    // Ranked by records affected, then by how sure the proposals are.
    .sort((x, y) => y.records - x.records || y.avg_confidence - x.avg_confidence);
}

const columns: ColumnDef<QueueRow>[] = [
  { id: "object", accessorFn: (r) => formatModuleName(r.object_type), header: "Object" },
  {
    id: "rule",
    header: "Rule",
    accessorFn: (r) => r.rule_id ?? "",
    cell: ({ row }) => row.original.rule_id ? <RuleCell id={row.original.rule_id} /> : <span className="m-ink-3">—</span>,
  },
  { id: "records", accessorFn: (r) => r.records, header: "Records", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => row.original.records.toLocaleString() },
  { id: "confidence", accessorFn: (r) => r.avg_confidence, header: "Confidence", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => `${Math.round(row.original.avg_confidence * 100)}%` },
  {
    id: "proposed",
    header: "Proposed value",
    enableSorting: false,
    cell: ({ row }) => <ProposalCell proposal={row.original.proposed} />,
  },
  { id: "batch", accessorFn: (r) => r.batch_id, header: "Batch", cell: ({ row }) => <Mono>{row.original.batch_id}</Mono> },
  {
    id: "action",
    header: "",
    size: 90,
    enableSorting: false,
    cell: ({ row }) => (
      <span onClick={(e) => e.stopPropagation()}>
        <Link href={`/fix/${row.original.batch_id}`} aria-label={`Review ${row.original.rule_id ?? "proposals"} in batch ${row.original.batch_id}`} className="m-ink-accent">Review</Link>
      </span>
    ),
  },
];

function CleaningQueueTab() {
  const router = useRouter();
  const dayOne = useDayOne();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...queryKeys.batch("list"), page],
    queryFn: () => getCleaningQueue({ per_page: 100, page }),
  });
  const rows = useMemo(() => groupIntoRows(data?.items ?? []), [data]);
  const confident = rows.filter((r) => r.avg_confidence >= HIGH_CONFIDENCE).reduce((n, r) => n + r.records, 0);
  const records = rows.reduce((n, r) => n + r.records, 0);
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 100));
  // N2: these call downloadCleaningExport, a plain cleaning-queue export — not the
  // remediation cockpit workbook or a real mass-change CSV. Labelling them "Cockpit"
  // / "Mass change CSV" was misleading on files meant for direct SAP reimport.
  const exportOptions = [
    { format: "xlsx" as const, label: "Approved fixes (.xlsx)", run: () => downloadCleaningExport("xlsx", "approved") },
    { format: "csv" as const, label: "Approved fixes (.csv)", run: () => downloadCleaningExport("csv", "approved") },
  ];

  return (
    <ExplorerPage
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No cleaning proposals",
        detail: dayOne.step?.detail ?? "When a run finds values a rule can correct, the proposals land here.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: refetch }}
      toolbarEnd={<ExportMenu options={rows.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />}
      summary={rows.length > 0 ? (
        <div className="m-stat-grid @5xl:[grid-template-columns:repeat(2,minmax(0,360px))]">
          <Stat label="Records with a proposal" value={records.toLocaleString()} hint={`${rows.length.toLocaleString()} rule${rows.length === 1 ? "" : "s"} across ${new Set(rows.map((r) => r.batch_id)).size.toLocaleString()} batch${new Set(rows.map((r) => r.batch_id)).size === 1 ? "" : "es"}`} />
          <Stat label="At 85% confidence or higher" value={confident.toLocaleString()} tone={confident > 0 ? "go" : undefined} hint="ready to accept in the batch" />
        </div>
      ) : undefined}
      table={
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            onRowClick={(row) => router.push(`/fix/${row.batch_id}`)}
          />
          {(data?.total ?? 0) > 100 && <Pager page={page} pageCount={pageCount} pageSize={100} total={data?.total ?? 0} onPageChange={setPage} />}
        </div>
      }
    />
  );
}

export default function FixPage() {
  const [tabRaw, setTab] = useUrlState("tab", "cleaning");
  const tab = oneOf(tabRaw, ["cleaning", "batches", "monitor", "dedup"], "cleaning");

  return (
    <div className="flex flex-col gap-4">
    <PageHeader title="Fix" meta="Review proposals, approve batches and hand them to SAP" />
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "cleaning", label: "Cleaning queue", content: <CleaningQueueTab /> },
        { value: "batches", label: "Batches", content: <BatchesTab /> },
        { value: "monitor", label: "Monitor", content: <MonitorTab /> },
        { value: "dedup", label: "Duplicates", content: <DedupTab /> },
      ]}
    />
    </div>
  );
}
