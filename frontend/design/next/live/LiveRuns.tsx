"use client";

import { useState } from "react";
import { formatCompact, formatDuration, formatInt, formatPct } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { JOB_KIND_LABEL } from "@/lib/v2/jobs";
import { useLiveRuns, type RunProgress } from "@/lib/api/next/live-runs";
import { SidePanel } from "../kit";
import { ProgressRing, SegmentedBar, ThroughputSpark, stateWord } from "./LiveCharts";
import { LiveRunCard, etaText, runObject, segmentsOf, stepText } from "./LiveRunCard";
import "./live.css";

/** Detail: the ring, then every stage or table with its own bar and a plain table of the same numbers. */
function RunDetail({ run, rates }: { run: RunProgress; rates: number[] }) {
  const segs = segmentsOf(run);
  const eta = etaText(run);
  return (
    <div className="nx-live-detail">
      <div className="nx-live-visual">
        <ProgressRing pct={run.pct} state={run.state} label={t("Overall progress")} />
        <div className="nx-live-side">
          <p className="nx-live-step">{stepText(run)}</p>
          <ThroughputSpark rates={rates} label={t("Throughput")} />
          {eta ? <p className="nx-live-quiet">{eta}</p> : null}
        </div>
      </div>
      <ul className="nx-live-parts">
        {segs.map((s) => (
          <li key={s.id} data-state={s.state}>
            <span className="nx-live-part-name" title={s.label}>{s.label}</span>
            <SegmentedBar segments={[s]} label={s.label} />
            <span className="nx-live-part-pct">{s.pct != null ? formatPct(s.pct) : stateWord(s.state)}</span>
          </li>
        ))}
      </ul>
      {run.parts.length ? (
        <table className="nx-live-table">
          <caption className="nx-sr">{t("Tables read so far")}</caption>
          <thead><tr><th scope="col">{t("Table")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Rows")}</th><th scope="col">{t("Expected")}</th></tr></thead>
          <tbody>
            {run.parts.map((p) => (
              <tr key={p.name}>
                <td className="nx-live-mono">{p.name}</td>
                <td>{stateWord(p.state)}</td>
                <td>{formatInt(p.done)}</td>
                <td>{p.total != null ? formatInt(p.total) : t("Unknown")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <dl className="nx-live-facts">
        <div><dt>{t("Records")}</dt><dd>{formatCompact(run.rows)}</dd></div>
        <div><dt>{t("Elapsed")}</dt><dd>{formatDuration(run.elapsed_s * 1000)}</dd></div>
        {run.rows_per_min != null ? <div><dt>{t("Average rate")}</dt><dd>{t("{n} rows/min", { n: formatCompact(run.rows_per_min) })}</dd></div> : null}
      </dl>
      {run.error ? <p className="nx-live-error">{run.error}</p> : null}
    </div>
  );
}

/** Runs in flight and those that ended in the last two minutes. Renders nothing when there are none or on error. */
export function LiveRuns() {
  const { runs, rates, isError } = useLiveRuns();
  const [open, setOpen] = useState<string | null>(null);
  if (isError || !runs.length) return null;
  const sel = runs.find((r) => r.id === open) ?? null;
  return (
    <section className="nx-live" aria-label={t("Live runs")} data-testid="live-runs">
      <h2 className="nx-live-h">{t("Live runs")} <span className="nx-live-quiet">{formatInt(runs.length)}</span></h2>
      <div className="nx-live-grid">
        {runs.map((r) => <LiveRunCard key={r.id} run={r} rates={rates.get(r.id) ?? []} onOpen={() => setOpen(r.id)} />)}
      </div>
      <SidePanel open={!!sel} onClose={() => setOpen(null)} title={sel ? `${JOB_KIND_LABEL[sel.kind] ?? sel.kind}: ${runObject(sel)}` : ""}>
        {sel ? <RunDetail run={sel} rates={rates.get(sel.id) ?? []} /> : null}
      </SidePanel>
    </section>
  );
}
