"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, DrillLink, EmptyState, ErrorState, Pill, Skeleton, Sparkline } from "@/design";
import { getTrends, type TrendFlag } from "@/lib/api/system-objects";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName, runAxisLabels } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { runPageHref } from "@/lib/runs";

const FLAG_LABEL: Record<TrendFlag, string> = {
  scope_changed: "Scope changed",
  rules_changed: "Rules changed",
  volume_shift: "Volume shifted",
  incomplete_extract: "Incomplete extract",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const deltaInk = (n: number) => (n > 0 ? "[color:var(--m-pass)]" : n < 0 ? "m-ink-critical" : "m-ink-2");

/** Score per object across this system's analysed runs. A change is only meaningful when the
 *  point is comparable (same scope, rule set and record volume); flags say why it is not. */
export function TrendPanel({ systemId }: { systemId: string }) {
  const q = useQuery({ queryKey: queryKeys.systemTrends(systemId), queryFn: () => getTrends(systemId, undefined, true) });
  if (q.isLoading) return <Skeleton height={96} />;
  if (isListFailure(q)) {
    return <ErrorState message={apiErrorMessage(q.error) || "Trends could not be read."} onRetry={() => q.refetch()} />;
  }
  const summary = q.data?.summary ?? [];
  const series = q.data?.series ?? {};
  return (
    <Card title="Trend per object" meta="How each object's score moved across runs. Notes flag a change that is not a like-for-like comparison">
      {!summary.length ? (
        <EmptyState title="No analysed run yet" detail="Trends need at least one analysed run." action={<Button render={<Link href={`/systems/${systemId}?tab=objects`}>Run analysis</Link>} />} />
      ) : (
        <table className="m-table">
          <thead>
            <tr>
              <th>Object</th><th>Score</th>
              <th>Last change</th><th>Trend</th>
              <th>Since baseline</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => {
              // Keyed by run id with the date as the label, so the sparkline's title names dates, never raw timestamps or upload labels.
              const scored = (series[s.object] ?? []).filter((p) => p.dqs !== null);
              const ticks = runAxisLabels(scored.map((p) => ({ id: p.version_id, run_at: p.run_at })));
              const pts = scored.map((p) => ({ x: p.version_id, label: ticks.get(p.version_id), y: p.dqs as number }));
              return (
                <tr key={s.object}>
                  <td>{formatModuleName(s.object)}</td>
                  <td>{s.dqs == null ? "—" : <DrillLink href={`/objects/${s.object}`}>{s.dqs.toFixed(1)}</DrillLink>}</td>
                  <td>
                    {s.dqs_delta == null ? "—" : <span className={deltaInk(s.dqs_delta)}>{signed(s.dqs_delta)}</span>}
                  </td>
                  <td>
                    {pts.length >= 2 ? (
                      // The trend opens the latest run of this object, scoped to that run and object.
                      <Link
                        href={runPageHref(pts[pts.length - 1].x, { module: s.object })}
                        aria-label={`Open the latest run of ${formatModuleName(s.object)}, ${pts[pts.length - 1].label}`}
                        title={`DQS from ${pts[0].label} to ${pts[pts.length - 1].label}: ${pts.map((p) => p.y).join(" → ")}`}
                        className="inline-block"
                      >
                        <Sparkline data={pts} />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {s.vs_baseline ? <span className={deltaInk(s.vs_baseline.dqs_delta)}>{signed(s.vs_baseline.dqs_delta)}</span> : "—"}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {s.flags.map((f) => <Pill key={f} tone="at-risk">{FLAG_LABEL[f]}</Pill>)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {summary.length > 0 && Object.values(series).every((s) => s.length < 2) ? (
        <EmptyState title="Only one analysed run" detail="A second analysis shows how each object moves." action={<Button render={<Link href={`/systems/${systemId}?tab=objects`}>Run a second analysis</Link>} />} />
      ) : null}
    </Card>
  );
}
