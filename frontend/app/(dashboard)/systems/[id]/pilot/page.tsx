"use client";

import { useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Upload } from "lucide-react";
import { Banner, Button, Chip, KpiRail, Panel, Stack, Stat, Text } from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
import { getScorecard, uploadKnownIssues, type RuleScore } from "@/lib/api/pilot";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)] align-top";
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

function RuleRow({ r }: { r: RuleScore }) {
  return (
    <tr>
      <td className={td}>
        <div className="font-mono">{r.check_id}</div>
        <div className="text-[12px] text-[var(--aurora-fg-tertiary)]">
          {formatModuleName(r.module)}{r.message ? ` — ${r.message}` : ""}
        </div>
      </td>
      <td className={`${td} text-right aurora-number`}>{r.flagged.toLocaleString()}</td>
      <td className={`${td} text-right aurora-number`}>{r.reviewed.toLocaleString()}</td>
      <td className={`${td} text-right aurora-number`}>{r.false_positive.toLocaleString()}</td>
      <td className={`${td} text-right aurora-number`}>{pct(r.precision)}</td>
      <td className={td}>
        {r.needs_tuning ? <Chip tone="danger">needs tuning</Chip>
          : r.rated ? <Chip tone="success">on target</Chip> : <Chip>too few reviews</Chip>}
      </td>
    </tr>
  );
}

export default function PilotScorecardPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useRole();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const { data, error } = useQuery({ queryKey: ["pilot-scorecard", id], queryFn: () => getScorecard(id) });
  const upload = useMutation({
    mutationFn: (file: File) => uploadKnownIssues(id, file),
    onSuccess: (r) => {
      toast.success(`${r.records.toLocaleString()} known issues loaded${r.rejected ? `, ${r.rejected} rows rejected` : ""}`);
      void qc.invalidateQueries({ queryKey: ["pilot-scorecard", id] });
    },
    onError: () => toast.error("Upload failed — expected a CSV with columns object,record,note"),
  });
  const p = data?.precision;
  const rec = data?.recall;
  const tuning = data?.rules.filter((r) => r.needs_tuning).length ?? 0;

  return (
    <div data-theme="light" className="space-y-6">
      <Link href={`/systems/${id}`}
        className="inline-flex items-center gap-1 text-[13px] text-[var(--aurora-fg-secondary)] hover:underline">
        <ArrowLeft size={14} /> System
      </Link>
      <PageHead
        title="Pilot scorecard"
        sub="How right Meridian is on this system, judged by your own stewards: precision from the decisions on record issues, recall against the records you already know are wrong."
        actions={can("manage_systems") ? (
          <>
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <Button size="sm" variant="secondary" leadingIcon={<Upload size={14} />} disabled={upload.isPending}
              onClick={() => input.current?.click()}>
              {rec?.known ? "Replace known issues" : "Upload known issues"}
            </Button>
          </>
        ) : undefined}
      />
      {error ? <Banner tone="danger" title="Could not load the scorecard">{(error as Error).message}</Banner> : null}

      <KpiRail>
        <Stat label="Precision" value={pct(p?.precision ?? null)} tone={p?.precision != null && p.precision < (p.target ?? 0.9) ? "warning" : "neutral"} />
        <Stat label="Issues reviewed" value={p?.reviewed.toLocaleString() ?? "—"} />
        <Stat label="False positives" value={p?.false_positives.toLocaleString() ?? "—"} />
        <Stat label="Recall" value={pct(rec?.recall ?? null)} />
        <Stat label="Known issues caught" value={rec ? `${rec.caught.toLocaleString()} / ${rec.known.toLocaleString()}` : "—"} />
        <Stat label="Rules to tune" value={tuning.toLocaleString()} tone={tuning ? "warning" : "neutral"} />
      </KpiRail>

      <Panel title="Precision per rule">
        <Stack gap={3}>
          <Text variant="text-small" tone="secondary">
            A reviewed issue is one closed as false positive, accepted risk or fixed. A rule is rated once{" "}
            {p?.min_reviewed_per_rule ?? 10} of its issues are reviewed, and needs tuning below {pct(p?.target ?? 0.9)}.
          </Text>
          {!data?.rules.length ? (
            <Text tone="muted">No record issues yet: run an analysis of this system first.</Text>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr>
                  <th className={th}>Rule</th><th className={`${th} text-right`}>Flagged</th>
                  <th className={`${th} text-right`}>Reviewed</th><th className={`${th} text-right`}>False positives</th>
                  <th className={`${th} text-right`}>Precision</th><th className={th}>Status</th>
                </tr></thead>
                <tbody>{data.rules.map((r) => <RuleRow key={`${r.module}/${r.check_id}`} r={r} />)}</tbody>
              </table>
            </div>
          )}
        </Stack>
      </Panel>

      <Panel title="Known issues Meridian missed">
        <Stack gap={3}>
          <Text variant="text-small" tone="secondary">
            Upload the records your stewards know are wrong as CSV: object,record,note. object is the Meridian object
            (e.g. accounts_payable) or blank for any; record is the SAP key, parts separated by | (e.g. 1000|100001).
            Leading zeros don&apos;t matter.
          </Text>
          {rec?.objects_not_analysed.length ? (
            <Banner tone="warning" title="Objects not analysed yet">
              {rec.objects_not_analysed.map(formatModuleName).join(", ")} — their known issues count as missed until
              they are downloaded and analysed.
            </Banner>
          ) : null}
          {!rec?.known ? (
            <Text tone="muted">No known issues uploaded.</Text>
          ) : !rec.missed_total ? (
            <Text tone="muted">Every known issue was caught.</Text>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><th className={th}>Object</th><th className={th}>Record</th><th className={th}>Note</th></tr></thead>
                <tbody>
                  {rec.missed.map((m) => (
                    <tr key={`${m.module}/${m.record_ref}`}>
                      <td className={td}>{m.module ? formatModuleName(m.module) : "any"}</td>
                      <td className={`${td} font-mono`}>{m.record_ref}</td>
                      <td className={td}>{m.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rec.missed_total > rec.missed.length && (
                <Text tone="muted">+{(rec.missed_total - rec.missed.length).toLocaleString()} more</Text>
              )}
            </div>
          )}
        </Stack>
      </Panel>
    </div>
  );
}
