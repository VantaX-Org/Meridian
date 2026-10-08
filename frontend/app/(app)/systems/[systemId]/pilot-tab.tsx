"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, DataTable, type AuroraColumnMeta } from "@/components/aurora";
import { EmptyState, Mono, SectionCard, StatusBadge, TableSkeleton, Tally } from "@/components/ui-core";
import { getScorecard, uploadKnownIssues, type KnownIssue, type RuleScore } from "@/lib/api/pilot";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const meta = (m: AuroraColumnMeta) => m;
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const n = (v: number) => v.toLocaleString();

/** Pilot scorecard: how right Meridian is on this system, judged by the stewards' own decisions. */
export function PilotTab({ id }: { id: string }) {
  const { can } = useRole();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: queryKeys.pilotScorecard(id), queryFn: () => getScorecard(id) });
  const upload = useMutation({
    mutationFn: (file: File) => uploadKnownIssues(id, file),
    onSuccess: (r) => {
      toast.success(`${n(r.records)} known issues loaded${r.rejected ? `, ${r.rejected} rows rejected` : ""}`);
      void qc.invalidateQueries({ queryKey: queryKeys.pilotScorecard(id) });
    },
    onError: () => toast.error("Upload failed. Expected a CSV with columns object,record,note."),
  });
  const data = q.data;
  const p = data?.precision;
  const rec = data?.recall;
  const tuning = data?.rules.filter((r) => r.needs_tuning).length ?? 0;
  const here = `/systems/${id}?tab=pilot`;

  const ruleCols = useMemo<ColumnDef<RuleScore, unknown>[]>(() => [
    { id: "rule", header: "Rule", meta: meta({ sticky: "start", width: 300 }), cell: ({ row }) => (
      <span className="ui-cell-stack">
        <Link href={`/findings?${new URLSearchParams({ check_id: row.original.check_id, module: row.original.module })}`} className="ui-link"><Mono>{row.original.check_id}</Mono></Link>
        <span className="ui-cell-stack__sub">{formatModuleName(row.original.module)}{row.original.message ? `. ${row.original.message}` : ""}</span>
      </span>) },
    { id: "flagged", header: "Flagged", meta: meta({ numeric: true, width: 100 }), cell: ({ row }) => n(row.original.flagged) },
    { id: "reviewed", header: "Reviewed", meta: meta({ numeric: true, width: 100 }), cell: ({ row }) => n(row.original.reviewed) },
    { id: "fp", header: "False positives", meta: meta({ numeric: true, width: 130 }), cell: ({ row }) => n(row.original.false_positive) },
    { id: "precision", header: "Precision", meta: meta({ numeric: true, width: 110 }),
      cell: ({ row }) => row.original.precision === null ? "—" : `${pct(row.original.precision)} (${n(row.original.real)} of ${n(row.original.reviewed)})` },
    { id: "status", header: "Status", meta: meta({ width: 150 }), cell: ({ row }) => row.original.needs_tuning
      ? <StatusBadge status="high">Needs tuning</StatusBadge>
      : row.original.rated ? <StatusBadge status="ok">On target</StatusBadge> : <StatusBadge status="idle">Too few reviews</StatusBadge> },
  ], []);

  const missedCols = useMemo<ColumnDef<KnownIssue, unknown>[]>(() => [
    { id: "object", header: "Object", meta: meta({ width: 180 }), cell: ({ row }) => row.original.module ? formatModuleName(row.original.module) : "Any" },
    { id: "record", header: "Record", meta: meta({ width: 220 }), cell: ({ row }) => <Mono>{row.original.record_ref}</Mono> },
    { id: "note", header: "Note", cell: ({ row }) => row.original.note ?? "" },
  ], []);

  if (q.isLoading) return <TableSkeleton rows={6} label="Loading the pilot scorecard" />;
  if (q.error) {
    return <Banner tone="danger" title="The scorecard could not be read" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Retry</Button>}>{(q.error as Error).message}</Banner>;
  }

  return (
    <div className="ui-stack">
      <Tally level={4} label="Pilot scorecard" figures={[
        { label: "Precision", value: p?.precision == null ? null : Math.round(p.precision * 1000) / 10, unit: p?.precision == null ? undefined : "percent", href: `${here}#rules`,
          tone: p?.precision != null && p.precision < (p.target ?? 0.9) ? "warning" : undefined,
          verdict: p ? `${n(p.reviewed - p.false_positives)} of ${n(p.reviewed)} reviewed issues were real.` : "No issues reviewed yet." },
        { label: "Recall", value: rec?.recall == null ? null : Math.round(rec.recall * 1000) / 10, unit: rec?.recall == null ? undefined : "percent", href: `${here}#missed`,
          verdict: rec?.known ? `${n(rec.caught)} of ${n(rec.known)} known issues were caught.` : "No known issues uploaded." },
        { label: "Rules to tune", value: tuning, href: `${here}#rules`, tone: tuning ? "warning" : undefined,
          verdict: tuning ? `${n(tuning)} of ${n(data?.rules.length ?? 0)} rules are below target.` : "No rule is below target." },
        { label: "Known issues missed", value: rec?.missed_total ?? 0, href: `${here}#missed`, tone: rec?.missed_total ? "high" : undefined,
          verdict: rec?.known ? `${n(rec.missed_total)} of ${n(rec.known)} were not flagged.` : "Upload known issues to measure recall." },
      ]} />

      <SectionCard title="Precision per rule" meta={`${data?.rules.length ?? 0} rules`}>
        <p className="ui-note" id="rules">
          A reviewed issue is one closed as false positive, accepted risk or fixed. A rule is rated once {p?.min_reviewed_per_rule ?? 10} of its
          issues are reviewed, and needs tuning below {pct(p?.target ?? 0.9)}.
        </p>
        {data?.rules.length ? (
          <DataTable columns={ruleCols} data={data.rules} getRowId={(r) => `${r.module}/${r.check_id}`} ariaLabel="Precision per rule" maxHeight="50vh" />
        ) : (
          <EmptyState action={<Link href="/analyse" className="ui-link">Open Analyse</Link>}>No record issues yet. Run an analysis of this system first.</EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Known issues Meridian missed" meta={rec?.known ? `${n(rec.missed_total)} of ${n(rec.known)}` : undefined}
        action={can("manage_systems") ? (
          <>
            <input ref={input} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <Button size="sm" variant="secondary" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {rec?.known ? "Replace known issues" : "Upload known issues"}
            </Button>
          </>
        ) : undefined}>
        <p className="ui-note" id="missed">
          Upload the records your stewards know are wrong as CSV with columns object, record and note. Object is the Meridian object, for example
          accounts_payable, or blank for any. Record is the SAP key with parts separated by a pipe, for example 1000|100001. Leading zeros do not matter.
        </p>
        {rec?.objects_not_analysed.length ? (
          <Banner tone="warning" title="Objects not analysed yet">
            {rec.objects_not_analysed.map(formatModuleName).join(", ")}. Their known issues count as missed until they are downloaded and analysed.
          </Banner>
        ) : null}
        {!rec?.known ? (
          <EmptyState>No known issues uploaded.</EmptyState>
        ) : !rec.missed_total ? (
          <EmptyState>Every known issue was caught.</EmptyState>
        ) : (
          <>
            <DataTable columns={missedCols} data={rec.missed} getRowId={(m) => `${m.module}/${m.record_ref}`} ariaLabel="Known issues missed" maxHeight="40vh" />
            {rec.missed_total > rec.missed.length ? <p className="ui-micro">{n(rec.missed_total - rec.missed.length)} more not shown.</p> : null}
          </>
        )}
      </SectionCard>
    </div>
  );
}
