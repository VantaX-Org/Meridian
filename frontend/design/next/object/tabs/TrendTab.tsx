"use client";

import "./tabs-g.css";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { ChangedCheck, ChangeKind } from "@/lib/api/v2/object";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { useChangedChecks, useCompare } from "@/lib/v2/object-queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useReceipt } from "@/lib/v2/queries";
import { runLabel } from "@/lib/v2/run-label";
import { f1, int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, DataTable, EmptyState, ErrorState, Skeleton, StatCard, type Column } from "../../kit";
import { AreaSpark } from "../../kit/viz";
import type { ObjectRun } from "../useObjectRun";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, ItemLink } from "./tabs-g-parts";

const shortDate = (iso: string | null): string => (iso ? formatDate(iso, "date").replace(/\s\d{4}$/, "") : "");
const longDate = (iso: string | null): string => (iso ? formatDate(iso, "date") : t("an earlier run"));

const KIND: { key: ChangeKind; title: () => string; tone: "good" | "bad" }[] = [
  { key: "newly_failing", title: () => t("Newly failing"), tone: "bad" },
  { key: "fixed", title: () => t("Fixed"), tone: "good" },
  { key: "worse", title: () => t("Worse"), tone: "bad" },
  { key: "better", title: () => t("Better"), tone: "good" },
];
const SHOWN = 3;

function movement(kind: ChangeKind, c: ChangedCheck): { text: string; delta: number } {
  const d = c.v2_affected - c.v1_affected;
  if (kind === "fixed") return { text: t("{v1_affected} records fixed", { v1_affected: int(c.v1_affected) }), delta: d };
  if (kind === "newly_failing") return { text: t("{v2_affected} records newly failing", { v2_affected: int(c.v2_affected) }), delta: d };
  if (kind === "worse") return { text: t("{d} more records failing", { d: int(Math.abs(d)) }), delta: d };
  return { text: t("{d} fewer records failing", { d: int(Math.abs(d)) }), delta: d };
}

const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${int(Math.abs(n))}`;

/** The runs behind the chart that the object has a score in, oldest first. */
function seriesOf(runs: readonly TimelineRun[], module: string): TimelineRun[] {
  return runs.filter((r) => r.objects[module] != null && (r.objects[module].raw_score ?? r.objects[module].score) != null);
}

function WhyMoved({ module, baseline, current }: { module: string; baseline: TimelineRun; current: TimelineRun }) {
  const summary = useCompare(baseline.id, current.id);
  const changed = useChangedChecks(baseline.id, current.id, module);
  const side = summary.data?.objects.find((o) => o.module === module);
  const before = side?.before?.raw_score ?? baseline.objects[module]?.raw_score ?? null;
  const after = side?.after?.raw_score ?? current.objects[module]?.raw_score ?? null;
  const change = before != null && after != null ? Math.round((after - before) * 10) / 10 : null;
  const shownBefore = side?.before?.score ?? baseline.objects[module]?.score ?? null;
  const shownAfter = side?.after?.score ?? current.objects[module]?.score ?? null;

  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Why the score moved")} data-testid="why-moved">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Why the score moved")}</h2>
        <span className="nx-tg-sub">{t("{longDate} against {longDate2}", { longDate: longDate(current.run_at), longDate2: longDate(baseline.run_at) })}</span>
      </div>
      {summary.isPending || changed.isPending ? (
        <Skeleton lines={5} />
      ) : summary.isError || changed.isError ? (
        <ErrorState
          sentence={t("The comparison of these two runs could not be read.")}
          error={summary.error ?? changed.error}
          onRetry={() => {
            void summary.refetch();
            void changed.refetch();
          }}
        />
      ) : (
        <>
          {KIND.map(({ key, title, tone }) => {
            const list = [...(changed.data?.[key] ?? [])].sort((a, b) => Math.abs(b.v2_affected - b.v1_affected) - Math.abs(a.v2_affected - a.v1_affected));
            if (list.length === 0) return null;
            const total = Math.max(list.length, side?.[key] ?? 0);
            const more = total - Math.min(list.length, SHOWN);
            return (
              <div key={key} className="nx-tg-l2" data-kind={key}>
                <h3>
                  <Chip tone={tone}>{title()}</Chip>
                  <span className="nx-tg-sub">{t("{total} {total2, plural, one {rule} other {rules}}", { total: int(total), total2: total })}</span>
                </h3>
                <ul className="nx-tg-list">
                  {list.slice(0, SHOWN).map((c) => {
                    const m = movement(key, c);
                    return (
                      <li key={c.check_id}>
                        <span className="nx-tg-rule">
                          <ItemLink kind="rule" id={c.check_id} className="nx-mono" />
                          <span>{c.message ?? ""}</span>
                        </span>
                        <span className="nx-tg-sub">
                          {m.text} <span className="nx-num">{signed(m.delta)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {total > SHOWN ? <p className="nx-tg-prov">{t("and {count} more {count2, plural, one {rule} other {rules}}", { count: int(more), count2: more })}</p> : null}
              </div>
            );
          })}
          <div className="nx-tg-row">
            <span className="nx-tg-finding">{t("Measured score")}</span>
            <span className="nx-tg-sub">{t("{before} on {longDate}, {after} on {longDate2}", { before: f1(before), longDate: longDate(baseline.run_at), after: f1(after), longDate2: longDate(current.run_at) })}</span>
            <span className="nx-num">{change == null ? <Dash /> : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)}`}</span>
          </div>
          {changed.data && KIND.every((k) => (changed.data?.[k.key] ?? []).length === 0) ? <p className="nx-tg-prov">{t("No rule changed enough between these two runs to move the score.")}</p> : null}
          <p className="nx-tg-prov">{summary.data?.method ?? t("Only rules that ran cleanly in both runs are compared.")}</p>
          {shownBefore != null && shownAfter != null && current.objects[module]?.capped && before != null && after != null && (shownBefore !== before || shownAfter !== after) ? (
            <p className="nx-tg-prov" data-testid="shown-note">
              {t("The shown score moved only {shownBefore} to {shownAfter}, because the cap holds it at {shownAfter}.", { shownBefore: f1(shownBefore), shownAfter: f1(shownAfter) })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Compare any two runs: the canvas for that is /run/{a}/vs/{b}. */
function ComparePicker({ runs, from, to, system, back }: { runs: TimelineRun[]; from: string; to: string; system: string; back: string }) {
  const router = useRouter();
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const label = (r: TimelineRun) => t("{run}, {date}", { run: runLabel(system, r.run_number), date: formatDate(r.run_at, "datetime") });
  const at = (id: string) => runs.find((r) => r.id === id)?.run_at ?? "";
  const inOrder = a !== b && at(a) < at(b);
  const why = a === b ? t("Pick two different runs.") : t("The earlier run must come before the later run.");
  return (
    <form className="nx-tg-form" aria-label={t("Compare two runs")} onSubmit={(e) => e.preventDefault()}>
      <span className="nx-tg-sub">{t("Compare with…")}</span>
      <select className="nx-input" value={a} onChange={(e) => setA(e.target.value)} aria-label={t("Earlier run")}>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {label(r)}
          </option>
        ))}
      </select>
      <span className="nx-tg-sub" aria-hidden="true">
        {t("with")}
      </span>
      <select className="nx-input" value={b} onChange={(e) => setB(e.target.value)} aria-label={t("Later run")}>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {label(r)}
          </option>
        ))}
      </select>
      <Button size={32} variant={inOrder ? "primary" : "secondary"} disabled={!inOrder} reason={inOrder ? undefined : why} onClick={() => router.push(`/run/${a}/vs/${b}?from=${encodeURIComponent(back)}`)}>
        {t("Compare")}
      </Button>
      {!inOrder ? (
        <span className="nx-tg-prov" data-testid="compare-order">
          {why}
        </span>
      ) : null}
    </form>
  );
}

/** The Trend tab: the score over every finished run of the object (up to 50), why it moved since the baseline, and any two runs to compare. */
export function TrendTab({ o }: { o: ObjectRun }) {
  const label = o.label;
  const systemName = o.systemName;
  const timeline = useTimeline(o.systemId, 50, o.module);
  const receipt = useReceipt(o.module, o.runId, Boolean(o.systemId)).data;

  const series = useMemo(() => seriesOf(timeline.data?.runs ?? [], o.module), [timeline.data, o.module]);
  const pinned = o.runId ? series.findIndex((r) => r.id === o.runId) : -1;
  const currentIdx = series.length === 0 ? -1 : pinned >= 0 ? pinned : series.length - 1;
  const current = currentIdx >= 0 ? series[currentIdx] : undefined;
  const earlier = current ? series.slice(0, currentIdx) : [];
  const baseline = [...earlier].reverse().find((r) => r.baseline) ?? earlier[earlier.length - 1];

  if (Boolean(o.systemId) && timeline.isPending) {
    return (
      <div aria-busy="true" data-testid="runs-loading">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (timeline.isError) return <ErrorState sentence={t("The run history could not be read.")} error={timeline.error} onRetry={() => void timeline.refetch()} />;
  if (!o.systemId || series.length < 2 || !current) {
    const only = series[0]?.objects[o.module];
    return (
      <EmptyState
        icon="info"
        heading={t("Trend")}
        action={
          <ItemLinkButton href="/runs">{t("Open the runs")}</ItemLinkButton>
        }
      >
        {only
          ? t("{label} has one scored run so far, measured {raw_score} and shown {score}. The history chart fills from the second run with the same rule set.", { label, raw_score: f1(only.raw_score), score: f1(only.score) })
          : t("{label} has no run history here yet. Each run adds a point once two runs have scored this object.", { label })}
      </EmptyState>
    );
  }

  const shown = (r: TimelineRun) => r.objects[o.module].score ?? r.objects[o.module].raw_score ?? 0;
  const cap = receipt?.cap_level ?? null;
  const first = series[0];
  const last = series[series.length - 1];
  const aria = t("Score of {label}, last {pointsCount} runs: {measured} on {label2}, {measured2} on {label3}{value}{value2}.", {
    label,
    pointsCount: series.length,
    measured: f1(shown(first)),
    label2: shortDate(first.run_at),
    measured2: f1(shown(last)),
    label3: shortDate(last.run_at),
    value: baseline ? t(". Baseline run {shortDate}", { shortDate: shortDate(baseline.run_at) }) : "",
    value2: cap != null ? t(". Cap {cap}", { cap }) : "",
  });
  const rows = [...series].reverse();
  const cur = current.objects[o.module];
  const base = baseline?.objects[o.module];

  const columns: Column<TimelineRun>[] = [
    {
      id: "run",
      label: t("Run"),
      cell: (r) => (
        <span className="nx-tg-row">
          <ItemLink kind="run" id={r.id}>
            {t("{run}, {date}", { run: runLabel(systemName, r.run_number), date: formatDate(r.run_at, "datetime") })}
          </ItemLink>
          {r.baseline ? <Chip tone="neutral">{t("baseline")}</Chip> : null}
        </span>
      ),
      compare: (x, y) => (x.run_at ?? "").localeCompare(y.run_at ?? ""),
    },
    { id: "measured", label: t("Measured"), align: "end", cell: (r) => <span className="nx-num">{f1(r.objects[o.module].raw_score)}</span>, compare: (x, y) => (x.objects[o.module].raw_score ?? 0) - (y.objects[o.module].raw_score ?? 0) },
    { id: "shown", label: t("Shown"), align: "end", cell: (r) => <span className="nx-num">{f1(r.objects[o.module].score)}</span>, compare: (x, y) => (x.objects[o.module].score ?? 0) - (y.objects[o.module].score ?? 0) },
    { id: "checked", label: t("Records checked"), align: "end", cell: (r) => <span className="nx-num">{int(r.records_checked)}</span>, compare: (x, y) => (x.records_checked ?? 0) - (y.records_checked ?? 0) },
  ];

  return (
    <div className="nx-tg" data-testid="tab-trend">
      <p className="nx-tg-finding">{t("{object} on {system}: the score at each of its {n} finished runs, newest {run}.", { object: label, system: systemName, n: series.length, run: runLabel(systemName, current.run_number) })}</p>
      <div className="nx-tg-stats">
        <StatCard label={t("Shown")} value={cur.score ?? 0} />
        <StatCard label={t("Measured")} value={cur.raw_score ?? 0} />
        {base ? <StatCard label={t("Measured score")} value={Math.round(((cur.raw_score ?? 0) - (base.raw_score ?? 0)) * 10) / 10} /> : null}
        <StatCard label={t("Records checked")} value={current.records_checked ?? 0} />
      </div>
      <section className="nx-card nx-tg-sec" aria-label={t("Score, last {pointsCount} runs", { pointsCount: series.length })}>
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("Score, last {pointsCount} runs", { pointsCount: series.length })}</h2>
          <span className="nx-tg-sub">{cap != null ? t("Held at {cap}.0 because {breachesCount, plural, one {# critical rule fails} other {# critical rules fail}}", { cap, breachesCount: receipt?.breaches.length ?? 0 }) : t("Nothing holds the score down")}</span>
        </div>
        <AreaSpark
          values={series.map(shown)}
          label={aria}
          height={160}
          testid="trend-chart"
          cap={cap != null ? { value: cap, label: t("cap {capLevel}", { capLevel: cap }) } : null}
          points={series.map((r) => ({ axis: shortDate(r.run_at), title: t("{name}, {date}: score {score}", { name: runLabel(systemName, r.run_number), date: longDate(r.run_at), score: f1(shown(r)) }) }))}
        />
        <p className="nx-tg-prov">{t("{object}, the score shown per finished run (after any cap, as in the header). Hover a point for its run and date.", { object: label })}</p>
        <ExportTable><DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowLabel={(r) => runLabel(systemName, r.run_number)}
          caption={t("Runs shown in the chart")}
          density="compact"
        /></ExportTable>
        <p className="nx-tg-prov">{t("Scores are as stored with each run; the measured score is before the cap, the shown score after it.")}</p>
        <ComparePicker runs={series} from={(baseline ?? series[0]).id} to={current.id} system={systemName} back={`/o/${o.systemSeg}/${o.moduleSeg}`} />
      </section>
      {baseline ? (
        <WhyMoved module={o.module} baseline={baseline} current={current} />
      ) : (
        <section className="nx-card nx-tg-sec" aria-label={t("Why the score moved")}>
          <h2 className="nx-sec-h">{t("Why the score moved")}</h2>
          <p className="nx-tg-prov">{t("This is the earliest run in view, so there is nothing before it to compare. The next run adds the comparison.")}</p>
        </section>
      )}
    </div>
  );
}

function ItemLinkButton({ href, children }: { href: string; children: string }) {
  const router = useRouter();
  return (
    <Button size={32} onClick={() => router.push(href)}>
      {children}
    </Button>
  );
}
