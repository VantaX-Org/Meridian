"use client";

import { ScrollFrame } from "./ScrollFrame";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import type { ChangedCheck, ChangeKind, TimelineRun } from "@/lib/api/v2/object";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useChangedChecks, useCompare, useTimeline } from "@/lib/v2/object-queries";
import { useNarrow } from "@/lib/v2/narrow";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { f1, findSystem, int, moduleFromSlug } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";
import { ScoreChart, type ChartPoint } from "./ScoreChart";

const shortDate = (iso: string | null): string => (iso ? formatDate(iso, "date").replace(/\s\d{4}$/, "") : "");
const longDate = (iso: string | null): string => (iso ? formatDate(iso, "date") : "an earlier run");

const KIND: { key: ChangeKind; title: string }[] = [
  { key: "newly_failing", title: "Newly failing" },
  { key: "fixed", title: "Fixed" },
  { key: "worse", title: "Worse" },
  { key: "better", title: "Better" },
];
const SHOWN = 3;

function movement(kind: ChangeKind, c: ChangedCheck): { text: string; delta: number } {
  const d = c.v2_affected - c.v1_affected;
  if (kind === "fixed") return { text: `${int(c.v1_affected)} records fixed`, delta: d };
  if (kind === "newly_failing") return { text: `${int(c.v2_affected)} records newly failing`, delta: d };
  if (kind === "worse") return { text: `${int(Math.abs(d))} more records failing`, delta: d };
  return { text: `${int(Math.abs(d))} fewer records failing`, delta: d };
}

const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${int(Math.abs(n))}`;

/** The runs behind the chart that the object has a score in, oldest first. */
function seriesOf(runs: readonly TimelineRun[], module: string): TimelineRun[] {
  return runs.filter((r) => r.objects[module] != null && (r.objects[module].raw_score ?? r.objects[module].score) != null).slice(-8);
}

function WhyMoved({ module, baseline, current }: { module: string; baseline: TimelineRun; current: TimelineRun }) {
  const { hrefFor } = useOpenItem();
  const summary = useCompare(baseline.id, current.id);
  const changed = useChangedChecks(baseline.id, current.id, module);
  const side = summary.data?.objects.find((o) => o.module === module);
  const before = side?.before?.raw_score ?? baseline.objects[module]?.raw_score ?? null;
  const after = side?.after?.raw_score ?? current.objects[module]?.raw_score ?? null;
  const change = before != null && after != null ? Math.round((after - before) * 10) / 10 : null;
  const shownBefore = side?.before?.score ?? baseline.objects[module]?.score ?? null;
  const shownAfter = side?.after?.score ?? current.objects[module]?.score ?? null;
  const sub = `${longDate(current.run_at)} against ${longDate(baseline.run_at)}`;

  return (
    <div data-testid="why-moved">
      <div className="m2-sechead">
        <h2 className="m2-h2">Why the score moved</h2>
        <span className="m2-sub">{sub}</span>
      </div>
      {summary.isPending || changed.isPending ? (
        <div aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ height: 32, display: "flex", alignItems: "center" }}>
              <Skeleton width={`${55 + ((i * 9) % 35)}%`} height={12} />
            </div>
          ))}
        </div>
      ) : summary.isError || changed.isError ? (
        <ErrorFrame onRetry={() => { void summary.refetch(); void changed.refetch(); }}>The comparison of these two runs could not be read.</ErrorFrame>
      ) : (
        <>
          <ul className="m2-why">
            {KIND.flatMap(({ key, title }) => {
              const list = [...(changed.data?.[key] ?? [])].sort((a, b) => Math.abs(b.v2_affected - b.v1_affected) - Math.abs(a.v2_affected - a.v1_affected));
              if (list.length === 0) return [];
              const total = Math.max(list.length, side?.[key] ?? 0);
              return [
                <li key={`${key}-h`} className="m2-whyh">
                  <span>{title}</span>
                  <span className="m2-s">{`${int(total)} ${total === 1 ? "rule" : "rules"}`}</span>
                  <span />
                </li>,
                ...list.slice(0, SHOWN).map((c) => {
                  const m = movement(key, c);
                  return (
                    <li key={`${key}-${c.check_id}`} data-kind={key}>
                      <span>
                        <V2Link href={hrefFor({ kind: "rule", id: c.check_id })} className="m2-mono">{c.check_id}</V2Link> {c.message ?? ""}
                      </span>
                      <span className="m2-s">{m.text}</span>
                      <span className="m2-e">{signed(m.delta)}</span>
                    </li>
                  );
                }),
                ...(total > SHOWN ? [<li key={`${key}-more`} className="m2-whymore"><span className="m2-meta">{`and ${int(total - Math.min(list.length, SHOWN))} more ${total - Math.min(list.length, SHOWN) === 1 ? "rule" : "rules"}`}</span><span /><span /></li>] : []),
              ];
            })}
            <li className="m2-tot">
              <span>Measured score</span>
              <span className="m2-s">{`${f1(before)} on ${longDate(baseline.run_at)}, ${f1(after)} on ${longDate(current.run_at)}`}</span>
              <span className="m2-e">{change == null ? <Dash /> : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)}`}</span>
            </li>
          </ul>
          {(changed.data && KIND.every((k) => (changed.data?.[k.key] ?? []).length === 0)) ? <p className="m2-prov">No rule changed enough between these two runs to move the score.</p> : null}
          <p className="m2-prov">{summary.data?.method ?? "Only rules that ran cleanly in both runs are compared."}</p>
          {shownBefore != null && shownAfter != null && current.objects[module]?.capped && before != null && after != null && (shownBefore !== before || shownAfter !== after) ? (
            <p className="m2-meta m2-prov" data-testid="shown-note">{`The shown score moved only ${f1(shownBefore)} to ${f1(shownAfter)}, because the cap holds it at ${f1(shownAfter)}.`}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Compare any two runs: the canvas for that is /v2/run/{a}/vs/{b}. */
function ComparePicker({ runs, from, to }: { runs: TimelineRun[]; from: string; to: string }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const label = (r: TimelineRun) => `Run ${formatDate(r.run_at, "datetime")}`;
  return (
    <form className="m2-cmp" aria-label="Compare two runs" onSubmit={(e) => e.preventDefault()}>
      <span className="m2-cmp-t">Compare with…</span>
      <label>
        <span className="m2-sr">Earlier run</span>
        <select value={a} onChange={(e) => setA(e.target.value)} aria-label="Earlier run">
          {runs.map((r) => (
            <option key={r.id} value={r.id}>{label(r)}</option>
          ))}
        </select>
      </label>
      <span className="m2-meta" aria-hidden="true">with</span>
      <label>
        <span className="m2-sr">Later run</span>
        <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Later run">
          {runs.map((r) => (
            <option key={r.id} value={r.id}>{label(r)}</option>
          ))}
        </select>
      </label>
      {a === b ? (
        <button type="button" className="m2-btn m2-sm" disabled>Compare</button>
      ) : (
        <V2Link href={`/v2/run/${a}/vs/${b}`} className="m2-btn m2-sm m2-strong">Compare</V2Link>
      )}
    </form>
  );
}

/** The Runs tab: the measured score over the last 8 runs, why it moved since the baseline, and any two runs to compare. */
export function RunsTab({ system: systemSegment, module: moduleSegment }: { system: string; module: string }) {
  const runParam = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(runParam);
  const system = L.data ? findSystem(L.data.systems, decodeURIComponent(systemSegment)) : undefined;
  const label = L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const timeline = useTimeline(system?.id);
  const receipt = useReceipt(apiModule, runParam, Boolean(system)).data;
  const { hrefFor } = useOpenItem();
  const narrow = useNarrow();

  const series = useMemo(() => seriesOf(timeline.data?.runs ?? [], apiModule), [timeline.data, apiModule]);
  const currentIdx = (() => {
    if (series.length === 0) return -1;
    const pinned = runParam ? series.findIndex((r) => r.id === runParam) : -1;
    return pinned >= 0 ? pinned : series.length - 1;
  })();
  const current = currentIdx >= 0 ? series[currentIdx] : undefined;
  const baseline = (() => {
    if (!current) return undefined;
    const earlier = series.slice(0, currentIdx);
    return [...earlier].reverse().find((r) => r.baseline) ?? earlier[earlier.length - 1];
  })();

  const points = useMemo<ChartPoint[]>(
    () =>
      series.map((r) => {
        const m = r.objects[apiModule].raw_score ?? r.objects[apiModule].score ?? 0;
        return { id: r.id, label: shortDate(r.run_at), title: `${longDate(r.run_at)}: measured ${f1(m)}`, measured: m, baseline: baseline?.id === r.id };
      }),
    [series, apiModule, baseline],
  );

  if (L.isPending || (Boolean(system) && timeline.isPending)) {
    return (
      <div aria-busy="true" data-testid="runs-loading">
        <Skeleton width="100%" height={232} />
      </div>
    );
  }
  if (timeline.isError) return <ErrorFrame onRetry={() => void timeline.refetch()}>The run history could not be read.</ErrorFrame>;
  if (!system || series.length < 2 || !current) {
    const only = series[0]?.objects[apiModule];
    return (
      <EmptyFrame action={<V2Link href="/v2/runs" className="m2-btn">Open the runs</V2Link>}>
        {only
          ? `${label} has one scored run so far, measured ${f1(only.raw_score)} and shown ${f1(only.score)}. The history chart fills from the second run with the same rule set.`
          : `${label} has no run history here yet. Each run adds a point once two runs have scored this object.`}
      </EmptyFrame>
    );
  }

  const cap = receipt?.cap_level ?? null;
  const first = points[0];
  const last = points[points.length - 1];
  const aria = `Measured score of ${label}, last ${points.length} runs: ${f1(first.measured)} on ${first.label}, ${f1(last.measured)} on ${last.label}${baseline ? `. Baseline run ${shortDate(baseline.run_at)}` : ""}${cap != null ? `. Cap ${cap}` : ""}.`;
  const rows = [...series].reverse();

  return (
    <div className="m2-rungrid">
      <div>
        <div className="m2-sechead">
          <h2 className="m2-h2">{`Measured score, last ${points.length} runs`}</h2>
          <span className="m2-sub">{cap != null ? `Cap ${cap}.0, ${receipt?.breaches.length ?? 0} critical rules over tolerance` : "No cap applies"}</span>
        </div>
        <ScoreChart points={points} capLevel={cap} label={aria} compact={narrow} />
        <ScrollFrame label="Runs, scrollable" style={{ marginTop: 16 }}>
          <table className="m2-tbl" aria-label="Runs shown in the chart">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col" className="m2-r">Measured</th>
                <th scope="col" className="m2-r">Shown</th>
                <th scope="col" className="m2-r">Records checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <V2Link href={hrefFor({ kind: "run", id: r.id })}>{`Run ${formatDate(r.run_at, "datetime")}`}</V2Link>
                    {r.baseline ? <span className="m2-meta"> baseline</span> : null}
                  </th>
                  <td className="m2-r">{f1(r.objects[apiModule].raw_score)}</td>
                  <td className="m2-r">{f1(r.objects[apiModule].score)}</td>
                  <td className="m2-r">{int(r.records_checked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
</ScrollFrame>
        <p className="m2-prov">Scores are as stored with each run; the measured score is before the cap, the shown score after it.</p>
        <ComparePicker runs={series} from={(baseline ?? series[0]).id} to={current.id} />
      </div>
      {baseline ? (
        <WhyMoved module={apiModule} baseline={baseline} current={current} />
      ) : (
        <div>
          <div className="m2-sechead"><h2 className="m2-h2">Why the score moved</h2></div>
          <EmptyFrame>This is the earliest run in view, so there is nothing before it to compare. The next run adds the comparison.</EmptyFrame>
        </div>
      )}
    </div>
  );
}
