"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton, Stat } from "@/design";
import { getScorecard, uploadKnownIssues, type KnownIssue, type RuleScore } from "@/lib/api/pilot";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const n = (v: number) => v.toLocaleString();
const card = "rounded border p-3";
const cardStyle = { borderColor: "var(--m-line)" };
const note = "text-[13px]";
const noteStyle = { color: "var(--m-ink-2)" };

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

  const ruleCols = useMemo<ColumnDef<RuleScore, unknown>[]>(() => [
    { id: "rule", header: "Rule", cell: ({ row }) => (
      <span className="flex flex-col">
        <Link href={`/findings?${new URLSearchParams({ check_id: row.original.check_id, module: row.original.module })}`} style={{ color: "var(--m-accent)" }}><Mono>{row.original.check_id}</Mono></Link>
        <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{formatModuleName(row.original.module)}{row.original.message ? `. ${row.original.message}` : ""}</span>
      </span>) },
    { id: "flagged", header: "Flagged", cell: ({ row }) => n(row.original.flagged) },
    { id: "reviewed", header: "Reviewed", cell: ({ row }) => n(row.original.reviewed) },
    { id: "fp", header: "False positives", cell: ({ row }) => n(row.original.false_positive) },
    { id: "precision", header: "Precision",
      cell: ({ row }) => row.original.precision === null ? "—" : `${pct(row.original.precision)} (${n(row.original.real)} of ${n(row.original.reviewed)})` },
    { id: "status", header: "Status", cell: ({ row }) => row.original.needs_tuning
      ? <Pill tone="at-risk">Needs tuning</Pill>
      : row.original.rated ? <Pill tone="go">On target</Pill> : <Pill>Too few reviews</Pill> },
  ], []);

  const missedCols = useMemo<ColumnDef<KnownIssue, unknown>[]>(() => [
    { id: "object", header: "Object", cell: ({ row }) => row.original.module ? formatModuleName(row.original.module) : "Any" },
    { id: "record", header: "Record", cell: ({ row }) => <Mono>{row.original.record_ref}</Mono> },
    { id: "note", header: "Note", cell: ({ row }) => row.original.note ?? "" },
  ], []);

  if (q.isLoading) return <Skeleton height={240} />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className={card} style={cardStyle}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Precision" value={p?.precision == null ? "—" : `${(p.precision * 100).toFixed(1)}%`}
            delta={p ? `${n(p.reviewed - p.false_positives)} of ${n(p.reviewed)} reviewed issues were real.` : "No issues reviewed yet."} />
          <Stat label="Recall" value={rec?.recall == null ? "—" : `${(rec.recall * 100).toFixed(1)}%`}
            delta={rec?.known ? `${n(rec.caught)} of ${n(rec.known)} known issues were caught.` : "No known issues uploaded."} />
          <Stat label="Rules to tune" value={n(tuning)}
            delta={tuning ? `${n(tuning)} of ${n(data?.rules.length ?? 0)} rules are below target.` : "No rule is below target."} />
          <Stat label="Known issues missed" value={n(rec?.missed_total ?? 0)}
            delta={rec?.known ? `${n(rec.missed_total)} of ${n(rec.known)} were not flagged.` : "Upload known issues to measure recall."} />
        </div>
      </div>

      <div className={card} style={cardStyle}>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Precision per rule</p>
          <p className={note} style={noteStyle}>{data?.rules.length ?? 0} rules</p>
        </div>
        <p className={`${note} mt-1`} style={noteStyle} id="rules">
          A reviewed issue is one closed as false positive, accepted risk or fixed. A rule is rated once {p?.min_reviewed_per_rule ?? 10} of its
          issues are reviewed, and needs tuning below {pct(p?.target ?? 0.9)}.
        </p>
        {data?.rules.length ? (
          <DataTable columns={ruleCols} data={data.rules} getRowId={(r) => `${r.module}/${r.check_id}`} height={420} />
        ) : (
          <EmptyState title="No record issues yet. Run an analysis of this system first."
            action={<Link href="/analyse" style={{ color: "var(--m-accent)" }}>Open Analyse</Link>} />
        )}
      </div>

      <div className={card} style={cardStyle}>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Known issues Meridian missed</p>
          <div className="flex items-center gap-2">
            {rec?.known ? <p className={note} style={noteStyle}>{n(rec.missed_total)} of {n(rec.known)}</p> : null}
            {can("manage_systems") ? (
              <>
                <input ref={input} type="file" accept=".csv,text/csv" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
                <Button variant="secondary" disabled={upload.isPending} onClick={() => input.current?.click()}>
                  {rec?.known ? "Replace known issues" : "Upload known issues"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <p className={`${note} mt-1`} style={noteStyle} id="missed">
          Upload the records your stewards know are wrong as CSV with columns object, record and note. Object is the Meridian object, for example
          accounts_payable, or blank for any. Record is the SAP key with parts separated by a pipe, for example 1000|100001. Leading zeros do not matter.
        </p>
        {rec?.objects_not_analysed.length ? (
          <div className="mt-2 rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-medium)", color: "var(--m-ink)" }}>
            <p className="font-medium" style={{ color: "var(--m-medium)" }}>Objects not analysed yet</p>
            <p className="mt-1" style={noteStyle}>
              {rec.objects_not_analysed.map(formatModuleName).join(", ")}. Their known issues count as missed until they are downloaded and analysed.
            </p>
          </div>
        ) : null}
        {!rec?.known ? (
          <EmptyState title="No known issues uploaded." />
        ) : !rec.missed_total ? (
          <EmptyState title="Every known issue was caught." />
        ) : (
          <>
            <DataTable columns={missedCols} data={rec.missed} getRowId={(m) => `${m.module}/${m.record_ref}`} height={340} />
            {rec.missed_total > rec.missed.length ? <p className="text-[12px] mt-1" style={{ color: "var(--m-ink-3)" }}>{n(rec.missed_total - rec.missed.length)} more not shown.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
