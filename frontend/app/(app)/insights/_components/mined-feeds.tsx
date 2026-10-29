"use client";

/**
 * What the miner found, as three tables: duplicate pairs (Insights › Duplicates; a pair is reviewed in Match review),
 * anomalies (Insights › Patterns) and field relationships (Insights › Lineage). The feeds read one run (`run`) or, in
 * the current state, every object at its own latest run (`scope=current`, api/routes/mining.py).
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, EmptyState, ErrorState, Mono, RowAction, Skeleton, Status, actionColumn } from "@/design";
import { mineLearnedRules } from "@/lib/api/learnedRules";
import {
  runMining,
  type MiningTask,
  getMiningAnomalies, getMiningDuplicates, getMiningRelationships,
  type MinedAnomaly, type MinedDuplicate, type MinedRelationship,
} from "@/lib/api/mining";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";

const pct = (v: number) => `${(v * (v <= 1 ? 100 : 1)).toFixed(0)}%`;
const LIMIT = 500;

/**
 * "Mine now" queues the miner that fills this feed on the current run (progress shows in the job tray; the API checks
 * the right to run it): the dedup, anomaly or relationship task for the mined feeds, the learned-rules miner for
 * patterns. Without a run it opens the runs list.
 */
export function MineNow({ run, task, variant = "primary" }: { run?: string; task?: MiningTask; variant?: "primary" | "secondary" }) {
  const mine = useMutation({
    mutationFn: async () => { await (task ? runMining(run as string, [task]) : mineLearnedRules(run as string)); },
    onSuccess: () => toast.success(`${task ? "Search" : "Mining"} started. Results appear here when it finishes; progress shows in the job tray.`),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (!run) return <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />;
  return <Button variant={variant} onClick={() => mine.mutate()} pending={mine.isPending}>{task ? "Search now" : "Mine now"}</Button>;
}

/** What the feeds read: one run, or the current state (every object at its own latest run). */
export interface MinedScope {
  /** The run, in one-run mode; ignored in the current state. */
  run: string;
  current: boolean;
}

const params = ({ run, current }: MinedScope) => (current ? { scope: "current" as const, limit: LIMIT } : { version_id: run || undefined, limit: LIMIT });
const key = (feed: string, { run, current }: MinedScope) => ["mining", feed, current ? "current" : run];

const enabledFor = (scope: MinedScope) => scope.current || !!scope.run;

/** The mined duplicate pairs of a scope. */
export function useMinedDuplicates(scope: MinedScope) {
  return useQuery({ queryKey: key("duplicates", scope), queryFn: () => getMiningDuplicates(params(scope)), enabled: enabledFor(scope) });
}

/** The mined anomalies of a scope. */
export function useMinedAnomalies(scope: MinedScope) {
  return useQuery({ queryKey: key("anomalies", scope), queryFn: () => getMiningAnomalies(params(scope)), enabled: enabledFor(scope) });
}

/** The mined field relationships of a scope. */
export function useMinedRelationships(scope: MinedScope) {
  return useQuery({ queryKey: key("relationships", scope), queryFn: () => getMiningRelationships(params(scope)), enabled: enabledFor(scope) });
}

function Feed<T>({ q, scope, task, empty, children }: { q: UseQueryResult<T[]>; scope: MinedScope; task: MiningTask; empty: { title: string; detail: string }; children: (rows: T[]) => ReactNode }) {
  // Mining runs on one run: in the current state there is no single run to start it on, so the action opens the runs.
  const mineRun = scope.current ? undefined : scope.run || undefined;
  if (!scope.current && !scope.run) return <EmptyState variant="inline" title="No finished run yet" detail="The search reads the records of a finished run." action={<MineNow run={mineRun} task={task} />} />;
  if (q.isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState variant="inline" title={empty.title} detail={empty.detail} action={<MineNow run={mineRun} task={task} />} />;
  return <>{children(rows)}</>;
}

const recordHref = (module: string, key: string, run: string) => `/objects/${module}/records/${encodeURIComponent(key)}?run=${run}`;
/** Match review with this pair selected: the record's pairs, and the one with the other record opened. */
export const matchReviewHref = (d: Pick<MinedDuplicate, "module_id" | "record_a" | "record_b">) =>
  `/mdm/golden/merge?object=${encodeURIComponent(d.module_id)}&record=${encodeURIComponent(d.record_a)}&with=${encodeURIComponent(d.record_b)}`;

export function MinedDuplicates({ q, scope }: { q: UseQueryResult<MinedDuplicate[]>; scope: MinedScope }) {
  const columns = useMemo<ColumnDef<MinedDuplicate>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.module_id) },
    { id: "a", header: "Record A", cell: ({ row }) => <DrillLink href={recordHref(row.original.module_id, row.original.record_a, row.original.version_id)}><Mono>{row.original.record_a}</Mono></DrillLink> },
    { id: "b", header: "Record B", cell: ({ row }) => <DrillLink href={recordHref(row.original.module_id, row.original.record_b, row.original.version_id)}><Mono>{row.original.record_b}</Mono></DrillLink> },
    { id: "score", header: "Match score", cell: ({ row }) => pct(row.original.match_score), meta: { numeric: true } },
    { id: "fields", header: "Matched on", cell: ({ row }) => (row.original.matched_fields?.length ? <Mono>{row.original.matched_fields.join(", ")}</Mono> : "—") },
    { id: "at", header: "Found", cell: ({ row }) => formatDate(row.original.detected_at, "date") },
    actionColumn((d) => <RowAction href={matchReviewHref(d)} label={`Review ${d.record_a} and ${d.record_b} in Match review`}>Review</RowAction>),
  ], []);
  return (
    <Feed q={q} scope={scope} task="dedup" empty={{ title: "No likely duplicates found yet", detail: "The search compares the records of a run and lists pairs that look like the same thing. Mine the run to find them." }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(d) => d.id} tableId="mined-duplicates" exportName="mined-duplicates" height={480} />}
    </Feed>
  );
}

/** The anomaly miner's detection methods (workers/tasks/mining/anomaly.py) in words; "Iqr" named nothing. */
const DETECTION_METHODS: Record<string, string> = { iqr: "Interquartile range", zscore: "Z-score", z_score: "Z-score" };

/** A detection method as a reader says it; an unknown one reads as words. */
export function detectionMethodLabel(method: string | null | undefined): string {
  const key = (method ?? "").toLowerCase();
  return Object.hasOwn(DETECTION_METHODS, key) ? DETECTION_METHODS[key] : labelOf(method);
}

/**
 * How far out a value is, in the words of the method that found it: its z-score, or the usual range (interquartile
 * method) it falls outside of. "—" when the miner kept neither.
 */
export function anomalyScore(a: Pick<MinedAnomaly, "z_score" | "lower_bound" | "upper_bound">): string {
  if (a.z_score != null) return `z ${a.z_score.toFixed(1)}`;
  if (a.lower_bound != null && a.upper_bound != null) return `usual ${a.lower_bound.toLocaleString()} to ${a.upper_bound.toLocaleString()}`;
  return "—";
}

/** The anomaly's record key; null for rows found before the key was kept (the table names their row instead). */
const anomalyRecord = (a: MinedAnomaly): string | null => a.record_key ?? null;

export function MinedAnomalies({ q, scope }: { q: UseQueryResult<MinedAnomaly[]>; scope: MinedScope }) {
  const columns = useMemo<ColumnDef<MinedAnomaly>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module_id} run={row.original.version_id}>{formatModuleName(row.original.module_id)}</DrillLink> },
    {
      // The record the value sits on, opening it; eleven outliers of one field are eleven different records.
      id: "record", header: "Record", accessorFn: (a) => a.record_key ?? "",
      cell: ({ row }) => {
        const key = anomalyRecord(row.original);
        if (key) return <DrillLink href={recordHref(row.original.module_id, key, row.original.version_id)}><Mono>{key}</Mono></DrillLink>;
        return row.original.record_index == null ? "—" : <span className="m-ink-3">Record {(row.original.record_index + 1).toLocaleString()}</span>;
      },
    },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field_name}</Mono> },
    { id: "value", header: "Value", cell: ({ row }) => (row.original.field_value === null ? "—" : <Mono>{row.original.field_value.toLocaleString()}</Mono>), meta: { numeric: true } },
    { id: "z", header: "How unusual", cell: ({ row }) => anomalyScore(row.original), meta: { numeric: true } },
    { id: "method", header: "Method", meta: { priority: "low" }, cell: ({ row }) => detectionMethodLabel(row.original.detection_method) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "at", header: "Found", meta: { priority: "low" }, cell: ({ row }) => formatDate(row.original.detected_at, "date") },
    actionColumn((a) => {
      const key = anomalyRecord(a);
      return key
        ? <RowAction href={recordHref(a.module_id, key, a.version_id)} label={`Open record ${key}`}>Open</RowAction>
        : <RowAction href={`/objects/${a.module_id}?run=${a.version_id}&tab=fields`} label={`Open ${formatModuleName(a.module_id)} fields`}>Open</RowAction>;
    }),
  ], []);
  return (
    <Feed q={q} scope={scope} task="anomaly" empty={{ title: "No anomalies found yet", detail: "The search flags values far outside the usual range. Search the run to look for them." }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(a) => a.id} tableId="mined-anomalies" exportName="mined-anomalies" height={480} />}
    </Feed>
  );
}

export function MinedRelationships({ q, scope }: { q: UseQueryResult<MinedRelationship[]>; scope: MinedScope }) {
  const columns = useMemo<ColumnDef<MinedRelationship>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module_id} run={row.original.version_id}>{formatModuleName(row.original.module_id)}</DrillLink> },
    { id: "a", header: "Field A", cell: ({ row }) => <Mono>{row.original.field_a}</Mono> },
    { id: "b", header: "Field B", cell: ({ row }) => <Mono>{row.original.field_b}</Mono> },
    { id: "type", header: "Relationship", cell: ({ row }) => labelOf(row.original.relationship_type) },
    { id: "strength", header: "Strength", cell: ({ row }) => pct(row.original.strength_score), meta: { numeric: true } },
    { id: "at", header: "Found", cell: ({ row }) => formatDate(row.original.detected_at, "date") },
  ], []);
  return (
    <Feed q={q} scope={scope} task="relationship" empty={{ title: "No field relationships found yet", detail: "The search finds fields whose values move together. Search the run to look for them." }}>
      {(rows) => <DataTable columns={columns} data={rows} getRowId={(r) => r.id} tableId="mined-relationships" exportName="mined-relationships" height={480} />}
    </Feed>
  );
}
