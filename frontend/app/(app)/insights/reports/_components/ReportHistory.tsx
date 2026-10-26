"use client";

/** Reports › History: every report file Meridian kept (downloads and scheduled runs), newest first. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, ConfirmDialog, DataTable, Pager, Pill, RowActionButton, Select, Skeleton, actionColumn, toast } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import { deleteReportFile, getReportHistory, getReportHistoryDownloadUrl, type ReportFile } from "@/lib/api/reports";
import { formatDate } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

export const HISTORY_PAGE = 10;
const ALL = "all";

/** 1,234 bytes reads "1.2 KB": one decimal under 10, none above. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

const SOURCE: Record<ReportFile["source"], string> = { download: "Downloaded", schedule: "Scheduled", run_now: "Run now" };

export function ReportHistory({ nameOf, kinds }: { nameOf: (kind: string) => string; kinds: readonly string[] }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState(ALL);
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<ReportFile | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const filter = kind === ALL ? undefined : kind;
  const q = useQuery({
    queryKey: queryKeys.reportHistory(filter, (page - 1) * HISTORY_PAGE),
    queryFn: () => getReportHistory({ kind: filter, limit: HISTORY_PAGE, offset: (page - 1) * HISTORY_PAGE }),
  });
  const del = useMutation({
    mutationFn: deleteReportFile,
    onSuccess: () => { toast.success("Report deleted"); void qc.invalidateQueries({ queryKey: ["reports", "history"] }); },
    onError: (e) => toast.error(`Not deleted. ${apiErrorMessage(e)}`),
  });
  const download = async (f: ReportFile) => {
    setFetching(f.id);
    try {
      await downloadAuthenticated(getReportHistoryDownloadUrl(f.id), f.file_name);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setFetching(null);
    }
  };

  const columns: ColumnDef<ReportFile>[] = [
    { id: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "type", header: "Type", cell: ({ row }) => nameOf(row.original.kind) },
    {
      id: "run", header: "Run",
      cell: ({ row }) => row.original.run_label ?? (row.original.run_at ? formatDate(row.original.run_at, "datetime") : <span className="m-ink-3">No run</span>),
    },
    { id: "format", header: "Format", cell: ({ row }) => <Pill tone="neutral">{row.original.format.toUpperCase()}</Pill> },
    { id: "size", header: "Size", cell: ({ row }) => <span className="m-numeric">{formatSize(row.original.size_bytes)}</span> },
    { id: "by", header: "By", cell: ({ row }) => row.original.created_by_label ?? SOURCE[row.original.source] },
    { id: "when", header: "When", cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
    actionColumn<ReportFile>((f) => (
      <span className="flex items-center gap-3">
        <RowActionButton label={`Download ${f.name}`} disabled={fetching === f.id} onClick={() => void download(f)}>Download</RowActionButton>
        {f.can_delete ? <RowActionButton label={`Delete ${f.name}`} onClick={() => setRemoving(f)}>Delete</RowActionButton> : null}
      </span>
    ), "Actions"),
  ];

  const total = q.data?.total ?? 0;
  return (
    <Card
      title="History"
      meta="Every report generated here or by a schedule, kept for download"
      actions={
        <Select
          label="Report type"
          value={kind}
          onValueChange={(v) => { setKind(v); setPage(1); }}
          options={[{ value: ALL, label: "All reports" }, ...kinds.map((k) => ({ value: k, label: nameOf(k) }))]}
        />
      }
    >
      {q.isError ? (
        <div className="flex items-center gap-3 m-text-body" role="alert">
          <span>{`The history did not load. ${apiErrorMessage(q.error)}`}</span>
          <Button variant="secondary" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : q.isLoading ? (
        <Skeleton height={120} />
      ) : (
        <div className="flex flex-col gap-3">
          <DataTable
            tableId="report-history"
            columns={columns}
            data={q.data?.items ?? []}
            getRowId={(r) => r.id}
            hideSearch
            emptyMessage={filter ? "No report of this type has been kept yet" : "No report has been kept yet. Downloads and scheduled runs show here"}
          />
          {total > HISTORY_PAGE ? (
            <Pager page={page} pageCount={Math.ceil(total / HISTORY_PAGE)} pageSize={HISTORY_PAGE} total={total} onPageChange={setPage} />
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title="Delete this report"
        tone="danger"
        body={`${removing?.file_name ?? "The file"} is removed from the history for everyone. The report can be generated again from the library.`}
        confirmLabel="Delete report"
        cancelLabel="Keep report"
        pending={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
    </Card>
  );
}
