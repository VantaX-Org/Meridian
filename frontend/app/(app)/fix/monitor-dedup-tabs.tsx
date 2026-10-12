"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Mono, Pill } from "@/design";
import { getDedupCandidates, type DedupCandidate } from "@/lib/api/cleaning";
import { getMonitor, type MonitorItem } from "@/lib/api/remediation";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, labelOf } from "@/lib/format";

const monitorColumns: ColumnDef<MonitorItem>[] = [
  { accessorKey: "scope", header: "Scope", cell: ({ row }) => <Mono>{row.original.scope}</Mono> },
  { id: "system", header: "System", cell: ({ row }) => row.original.system_name ?? "Not linked" },
  { id: "baseline", header: "Baseline score", cell: ({ row }) => row.original.baseline.dqs?.toFixed(1) ?? "-" },
  { id: "latest", header: "Latest score", cell: ({ row }) => row.original.latest.dqs?.toFixed(1) ?? "-" },
  { id: "new", header: "New failing records", cell: ({ row }) => row.original.monitor?.new_records.toLocaleString() ?? "-" },
  { id: "resolved", header: "Resolved", cell: ({ row }) => row.original.monitor?.resolved_records.toLocaleString() ?? "-" },
  {
    id: "regressed", header: "Regressed checks",
    cell: ({ row }) => {
      const n = row.original.monitor?.regressed_check_count ?? 0;
      return <Pill tone={n > 0 ? "no-go" : "go"}>{n}</Pill>;
    },
  },
  { id: "at", header: "Latest run", cell: ({ row }) => row.original.latest.run_at ? formatDate(row.original.latest.run_at, "date") : "-" },
];

/** Live remediation monitor: each scope's latest run against its baseline. */
export function MonitorTab() {
  const q = useQuery({ queryKey: ["remediation", "monitor"], queryFn: getMonitor });
  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      state={q.isLoading ? "loading" : isListFailure({ isError: q.isError, error: q.error }) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "Nothing is being monitored", detail: "A scope appears here once it has a baseline run and a later run to compare", action: <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={monitorColumns} data={items} getRowId={(r) => r.scope} />}
    />
  );
}

const dedupColumns: ColumnDef<DedupCandidate>[] = [
  { accessorKey: "object_type", header: "Object", cell: ({ row }) => labelOf(row.original.object_type) },
  { id: "a", header: "Record A", cell: ({ row }) => <Mono>{row.original.record_key_a}</Mono> },
  { id: "b", header: "Record B", cell: ({ row }) => <Mono>{row.original.record_key_b}</Mono> },
  { accessorKey: "match_score", header: "Match", cell: ({ row }) => `${Math.round(row.original.match_score)}%` },
  { accessorKey: "match_method", header: "Method", cell: ({ row }) => labelOf(row.original.match_method) },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "merged" ? "go" : "neutral"}>{labelOf(row.original.status)}</Pill> },
];

/** Duplicate candidate pairs; merging happens in MDM, so this is read-only. */
export function DedupTab() {
  const q = useQuery({ queryKey: ["dedup", "candidates"], queryFn: () => getDedupCandidates() });
  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      state={q.isLoading ? "loading" : isListFailure({ isError: q.isError, error: q.error }) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No duplicate candidates", detail: "Candidates appear after matching runs on a master-data object", action: <Button variant="secondary" render={<Link href="/mdm/match-rules">Tune match rules</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={dedupColumns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
