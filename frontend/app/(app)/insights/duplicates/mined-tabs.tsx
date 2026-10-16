"use client";

/** Insights › Duplicates: what the miner found for a run, as three tables (duplicate pairs, anomalies, field relationships). */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, EmptyState, ErrorState, Mono, Pill, Skeleton, type PillTone } from "@/design";
import { mineLearnedRules } from "@/lib/api/learnedRules";
import {
  runMining,
  type MiningTask,
  getMiningAnomalies, getMiningDuplicates, getMiningRelationships,
  type MinedAnomaly, type MinedDuplicate, type MinedRelationship,
} from "@/lib/api/mining";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";

const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral" };
const pct = (v: number) => `${(v * (v <= 1 ? 100 : 1)).toFixed(0)}%`;
const LIMIT = 500;

/**
 * "Mine now" queues the miner that fills this feed on the current run (progress shows in the job tray; the API checks
 * the right to run it): the dedup, anomaly or relationship task for the mined feeds, the learned-rules miner for
 * patterns. Without a run it opens the runs list.
 */
export function MineNow({ run, task }: { run?: string; task?: MiningTask }) {
  const mine = useMutation({
    mutationFn: async () => { await (task ? runMining(run as string, [task]) : mineLearnedRules(run as string)); },
    onSuccess: () => toast.success("Mining started. Results appear here when it finishes; progress shows in the job tray."),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (!run) return <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />;
  return <Button onClick={() => mine.mutate()} pending={mine.isPending}>Mine now</Button>;
}

function Feed<T>({ q, run, task, empty, children }: { q: UseQueryResult<T[]>; run?: string; task: MiningTask; empty: { title: string; detail: string }; children: (rows: T[]) => ReactNode }) {
  if (q.isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title={empty.title} detail={empty.detail} ghost="table" action={<MineNow run={run} task={task} />} />;
  }
  return <>{children(rows)}</>;
}

const recordHref = (module: string, key: string, run: string) => `/objects/${module}/records/${encodeURIComponent(key)}?run=${run}`;

export function MinedDuplicates({ run }: { run: string }) {
  const q = useQuery({ queryKey: ["mining", "duplicates", run], queryFn: () => getMiningDuplicates({ version_id: run || undefined, limit: LIMIT }) });
  const columns = useMemo<ColumnDef<MinedDuplicate>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.module_id) },
    { id: "a", header: "Record A", cell: ({ row }) => <DrillLink href={recordHref(row.original.module_id, row.original.record_a, row.original.version_id)}><Mono>{row.original.record_a}</Mono></DrillLink> },
    { id: "b", header: "Record B", cell: ({ row }) => <DrillLink href={recordHref(row.original.module_id, row.original.record_b, row.original.version_id)}><Mono>{row.original.record_b}</Mono></DrillLink> },
    { id: "score", header: "Match", cell: ({ row }) => pct(row.original.match_score), meta: { numeric: true } },
    { id: "fields", header: "Matched on", cell: ({ row }) => (row.original.matched_fields?.length ? <Mono>{row.original.matched_fields.join(", ")}</Mono> : "—") },
    { id: "at", header: "Found", cell: ({ row }) => formatDate(row.original.detected_at, "date") },
  ], []);
  return (
    <Feed q={q} run={run} task="dedup" empty={{ title: "No duplicate pairs mined", detail: "Mining finds likely duplicates after an analysis" }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(d) => d.id} tableId="mined-duplicates" exportName="mined-duplicates" height={480} />}
    </Feed>
  );
}

export function MinedAnomalies({ run }: { run: string }) {
  const q = useQuery({ queryKey: ["mining", "anomalies", run], queryFn: () => getMiningAnomalies({ version_id: run || undefined, limit: LIMIT }) });
  const columns = useMemo<ColumnDef<MinedAnomaly>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module_id} run={row.original.version_id}>{formatModuleName(row.original.module_id)}</DrillLink> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field_name}</Mono> },
    { id: "value", header: "Value", cell: ({ row }) => (row.original.field_value === null ? "—" : row.original.field_value.toLocaleString()), meta: { numeric: true } },
    { id: "method", header: "Method", cell: ({ row }) => labelOf(row.original.detection_method) },
    { id: "z", header: "Z-score", cell: ({ row }) => (row.original.z_score === null ? "—" : row.original.z_score.toFixed(1)), meta: { numeric: true } },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "at", header: "Found", cell: ({ row }) => formatDate(row.original.detected_at, "date") },
  ], []);
  return (
    <Feed q={q} run={run} task="anomaly" empty={{ title: "No anomalies mined", detail: "Mining flags statistical outliers after an analysis" }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(a) => a.id} tableId="mined-anomalies" exportName="mined-anomalies" height={480} />}
    </Feed>
  );
}

export function MinedRelationships({ run }: { run: string }) {
  const q = useQuery({ queryKey: ["mining", "relationships", run], queryFn: () => getMiningRelationships({ version_id: run || undefined, limit: LIMIT }) });
  const columns = useMemo<ColumnDef<MinedRelationship>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module_id} run={row.original.version_id}>{formatModuleName(row.original.module_id)}</DrillLink> },
    { id: "a", header: "Field A", cell: ({ row }) => <Mono>{row.original.field_a}</Mono> },
    { id: "b", header: "Field B", cell: ({ row }) => <Mono>{row.original.field_b}</Mono> },
    { id: "type", header: "Relationship", cell: ({ row }) => labelOf(row.original.relationship_type) },
    { id: "strength", header: "Strength", cell: ({ row }) => pct(row.original.strength_score), meta: { numeric: true } },
    { id: "at", header: "Found", cell: ({ row }) => formatDate(row.original.detected_at, "date") },
  ], []);
  return (
    <Feed q={q} run={run} task="relationship" empty={{ title: "No relationships mined", detail: "Mining finds fields that move together after an analysis" }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(r) => r.id} tableId="mined-relationships" exportName="mined-relationships" height={480} />}
    </Feed>
  );
}
