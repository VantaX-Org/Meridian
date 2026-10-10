"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Pill, Skeleton, Sparkline } from "@/design";
import { getTrends, type TrendFlag } from "@/lib/api/system-objects";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium";
const thStyle = { color: "var(--m-ink-3)" };
const td = "px-3 py-1.5 border-t";
const tdStyle = { borderColor: "var(--m-line)" };

const FLAG_LABEL: Record<TrendFlag, string> = {
  scope_changed: "Scope changed",
  rules_changed: "Rules changed",
  volume_shift: "Volume shifted",
  incomplete_extract: "Incomplete extract",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const deltaColor = (n: number) => (n > 0 ? "var(--m-pass)" : n < 0 ? "var(--m-critical)" : "var(--m-ink-2)");

/** Score per object across this system's analysed runs. A change is only meaningful when the
 *  point is comparable (same scope, rule set and record volume); flags say why it is not. */
export function TrendPanel({ systemId }: { systemId: string }) {
  const q = useQuery({ queryKey: queryKeys.systemTrends(systemId), queryFn: () => getTrends(systemId, undefined, true) });
  if (q.isLoading) return <Skeleton height={96} />;
  if (q.isError) {
    return <ErrorState message={apiErrorMessage(q.error) || "Trends could not be read."} onRetry={() => q.refetch()} />;
  }
  const summary = q.data?.summary ?? [];
  const series = q.data?.series ?? {};
  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Trend per object</p>
      {!summary.length ? (
        <EmptyState title="No analysed run yet." />
      ) : (
        <table className="mt-2 w-full text-[13px]">
          <thead>
            <tr>
              <th className={th} style={thStyle}>Object</th><th className={th} style={thStyle}>DQS</th>
              <th className={th} style={thStyle}>Last change</th><th className={th} style={thStyle}>Trend</th>
              <th className={th} style={thStyle}>Since baseline</th><th className={th} style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => {
              const pts = (series[s.object] ?? []).flatMap((p) => (p.dqs === null ? [] : [{ x: p.run_at, y: p.dqs }]));
              return (
                <tr key={s.object}>
                  <td className={td} style={tdStyle}>{formatModuleName(s.object)}</td>
                  <td className={td} style={tdStyle}>{s.dqs == null ? "—" : s.dqs.toFixed(1)}</td>
                  <td className={td} style={tdStyle}>
                    {s.dqs_delta == null ? "—" : <span style={{ color: deltaColor(s.dqs_delta) }}>{signed(s.dqs_delta)}</span>}
                  </td>
                  <td className={td} style={tdStyle}>
                    {pts.length >= 2 ? (
                      <span title={`DQS from ${pts[0].x} to ${pts[pts.length - 1].x}: ${pts.map((p) => p.y).join(" → ")}`}>
                        <Sparkline data={pts} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={td} style={tdStyle}>
                    {s.vs_baseline ? <span style={{ color: deltaColor(s.vs_baseline.dqs_delta) }}>{signed(s.vs_baseline.dqs_delta)}</span> : "—"}
                  </td>
                  <td className={td} style={tdStyle}>
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
    </div>
  );
}
