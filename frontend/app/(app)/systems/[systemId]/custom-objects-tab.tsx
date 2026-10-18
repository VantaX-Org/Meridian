"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton, Tabs, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import {
  detectZObjectsNow, getZAnomalies, getZDormant, getZDrift, getZGhost, getZProfile, getZRegistry, submitZAnomalyFeedback,
  type ZAnomaly, type ZAnomalyVerdict, type ZDormant, type ZDrift, type ZGhost, type ZRegistryEntry,
} from "@/lib/api/z-objects";
import { apiErrorMessage, isNotFound, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import { MappingSection, RegistryEditor, ReportDialog, RulesSection } from "./z-object-panels";
import { useRerun } from "./use-rerun";

const n = (v: number) => v.toLocaleString();
const dash = (v: string | null | undefined) => v ?? "—";
const note = { color: "var(--m-ink-2)" };
const analyseAction = <Button render={<Link href="/analyse">Run an analysis</Link>} />;

function Feed<T>({ q, children }: { q: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (q.isLoading) return <Skeleton height={200} />;
  if (q.error && isNotFound(q.error)) return <EmptyState title="No custom object analysis yet" detail="An analysis detects the custom Z objects." action={analyseAction} />;
  if (q.error) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  return <>{q.data ? children(q.data) : null}</>;
}

function useZ<T>(key: string, fn: () => Promise<T>) {
  return useQuery({ queryKey: ["z-objects", key], queryFn: fn, retry: false });
}

function ProfileDetail({ entry }: { entry: ZRegistryEntry }) {
  const { can } = useRole();
  const q = useQuery({ queryKey: ["z-objects", "profile", entry.id], queryFn: () => getZProfile(entry.id), retry: false });
  return (
    <div className="flex flex-col gap-3 m-text-body">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt style={note}>Category</dt><dd>{labelOf(entry.category)}</dd>
        <dt style={note}>Rules applied</dt><dd>{entry.rules_applied.length ? entry.rules_applied.join(", ") : "None"}</dd>
      </dl>
      <RegistryEditor key={entry.id} entry={entry} canEdit={can("manage_rules")} />
      <p className="font-medium" style={{ color: "var(--m-ink)" }}>Profile</p>
      {q.isLoading ? <Skeleton height={80} /> : q.error ? (
        <p style={note}>{isNotFound(q.error) ? "No profile recorded for this object." : apiErrorMessage(q.error)}</p>
      ) : q.data ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt style={note}>Data type</dt><dd>{q.data.data_type}</dd>
          <dt style={note}>Distinct values</dt><dd>{n(q.data.cardinality)}</dd>
          <dt style={note}>Empty</dt><dd>{(q.data.null_rate * 100).toFixed(1)}%</dd>
          <dt style={note}>Transactions</dt><dd>{n(q.data.transaction_count)}</dd>
          <dt style={note}>Users</dt><dd>{n(q.data.user_count)}</dd>
          <dt style={note}>Trend</dt><dd>{dash(q.data.trend_direction)}</dd>
        </dl>
      ) : null}
    </div>
  );
}

function RegistrySection() {
  const q = useZ("registry", getZRegistry);
  const cols = useMemo<ColumnDef<ZRegistryEntry, unknown>[]>(() => [
    { id: "name", header: "Object", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "std", header: "Standard equivalent", cell: ({ row }) => dash(row.original.standard_equivalent) },
    { id: "tx", header: "Transactions", cell: ({ row }) => n(row.original.transaction_count_total) },
    { id: "last", header: "Last active", cell: ({ row }) => dash(row.original.last_active_date) },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "active" ? "go" : "at-risk"}>{labelOf(row.original.status)}</Pill> },
  ], []);
  return (
    <Feed q={q}>
      {(d) => d.entries.length === 0 ? <EmptyState title="No custom objects registered" detail="Custom Z objects appear once an analysis finds them." action={analyseAction} /> : (
        <DataTable columns={cols} data={d.entries} getRowId={(e) => e.id} height={420} exportName="z-object-registry"
          renderDrawer={(e) => <ProfileDetail entry={e} />} />
      )}
    </Feed>
  );
}

function AnomaliesSection() {
  const q = useZ("anomalies", getZAnomalies);
  const qc = useQueryClient();
  const { can } = useRole();
  const feedback = useMutation({
    mutationFn: (v: { id: string; verdict: ZAnomalyVerdict }) => submitZAnomalyFeedback(v.id, v.verdict),
    onSuccess: (_, v) => {
      toast.success(v.verdict === "dismissed" ? "Marked as expected" : "Marked to investigate");
      void qc.invalidateQueries({ queryKey: ["z-objects"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const pendingId = feedback.isPending ? feedback.variables?.id : undefined;
  const cols = useMemo<ColumnDef<ZAnomaly, unknown>[]>(() => [
    { id: "name", header: "Object", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "type", header: "Anomaly", cell: ({ row }) => labelOf(row.original.anomaly_type) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "desc", header: "Description", cell: ({ row }) => row.original.description },
    { id: "dev", header: "Deviation", cell: ({ row }) => `${row.original.deviation_pct.toFixed(1)}%` },
    { id: "status", header: "Status", cell: ({ row }) => labelOf(row.original.status) },
    {
      id: "feedback",
      header: "",
      cell: ({ row }) => {
        const a = row.original;
        if (!a.id || !can("ai_feedback") || a.status !== "active") return null;
        const id = a.id;
        return (
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => feedback.mutate({ id, verdict: "dismissed" })} pending={pendingId === id && feedback.variables?.verdict === "dismissed"} disabled={pendingId === id}>Expected</Button>
            <Button variant="secondary" size="sm" onClick={() => feedback.mutate({ id, verdict: "confirmed" })} pending={pendingId === id && feedback.variables?.verdict === "confirmed"} disabled={pendingId === id}>Investigate</Button>
          </span>
        );
      },
    },
  ], [can, feedback, pendingId]);
  return (
    <Feed q={q}>
      {(d) => d.anomalies.length === 0 ? <EmptyState title="No anomalies detected" detail="The latest analysis found no anomalous custom objects." action={analyseAction} /> : (
        <DataTable columns={cols} data={d.anomalies} getRowId={(a) => a.id ?? `${a.object_name}/${a.anomaly_type}`} height={380} exportName="z-object-anomalies" />
      )}
    </Feed>
  );
}

function GhostSection() {
  const q = useZ("ghost", getZGhost);
  const cols = useMemo<ColumnDef<ZGhost, unknown>[]>(() => [
    { id: "name", header: "Object", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "field", header: "Source field", cell: ({ row }) => <Mono>{row.original.source_field}</Mono> },
    { id: "last", header: "Last active", cell: ({ row }) => dash(row.original.last_active_date) },
  ], []);
  return <Feed q={q}>{(d) => d.length === 0 ? <EmptyState title="No ghost objects" detail="The latest analysis found no unused custom objects." action={analyseAction} /> : <DataTable columns={cols} data={d} getRowId={(g) => `${g.object_name}/${g.source_field}`} height={360} exportName="z-object-ghost" />}</Feed>;
}

function DormantSection() {
  const q = useZ("dormant", getZDormant);
  const cols = useMemo<ColumnDef<ZDormant, unknown>[]>(() => [
    { id: "name", header: "Object", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "last", header: "Last active", cell: ({ row }) => dash(row.original.last_active_date) },
    { id: "months", header: "Months inactive", cell: ({ row }) => n(row.original.months_inactive) },
  ], []);
  return <Feed q={q}>{(d) => d.length === 0 ? <EmptyState title="No dormant objects" detail="The latest analysis found no dormant custom objects." action={analyseAction} /> : <DataTable columns={cols} data={d} getRowId={(g) => g.object_name} height={360} exportName="z-object-dormant" />}</Feed>;
}

function DriftSection() {
  const q = useZ("drift", getZDrift);
  const cols = useMemo<ColumnDef<ZDrift, unknown>[]>(() => [
    { id: "name", header: "Object", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "field", header: "Source field", cell: ({ row }) => <Mono>{row.original.source_field}</Mono> },
    { id: "change", header: "Change", cell: ({ row }) => <Pill>{labelOf(row.original.change_type)}</Pill> },
    { id: "when", header: "First detected", cell: ({ row }) => dash(row.original.first_detected) },
  ], []);
  return <Feed q={q}>{(d) => d.length === 0 ? <EmptyState title="No drift in custom objects" detail="Custom objects are unchanged since the previous run." action={analyseAction} /> : <DataTable columns={cols} data={d} getRowId={(g) => `${g.object_name}/${g.source_field}/${g.change_type}`} height={360} exportName="z-object-drift" />}</Feed>;
}

/** Systems/[id] › Custom objects. Z-object intelligence is tenant-wide, like configuration analysis. */
export function CustomObjectsTab({ systemId }: { systemId?: string }) {
  const { can } = useRole();
  const [reportOpen, setReportOpen] = useState(false);
  const detect = useRerun({
    run: () => detectZObjectsNow(systemId),
    queryKey: ["z-objects"],
    queued: "Detection queued. Results refresh as it finishes",
    done: "Custom object results refreshed",
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-text-body" style={note}>Custom (Z) objects found across every connected system in this workspace.</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setReportOpen(true)}>Report</Button>
          {can("analyse") ? <Button onClick={() => detect.mutate()} pending={detect.isPending}>Detect now</Button> : null}
        </div>
      </div>
      <Tabs
        items={[
          { value: "registry", label: "Registry", content: <RegistrySection /> },
          { value: "anomalies", label: "Anomalies", content: <AnomaliesSection /> },
          { value: "ghost", label: "Ghost", content: <GhostSection /> },
          { value: "dormant", label: "Dormant", content: <DormantSection /> },
          { value: "drift", label: "Drift", content: <DriftSection /> },
          { value: "rules", label: "Rules", content: <RulesSection canCreate={can("manage_rules")} /> },
          { value: "mapping", label: "Mapping", content: <MappingSection /> },
        ]}
      />
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}
