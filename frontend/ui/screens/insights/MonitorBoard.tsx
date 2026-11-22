"use client";

/**
 * The top of the Monitor route: what the learned monitors found on the latest run, the score per run against its
 * usual band, new findings per run and the breaks held back under a raised minimum. Every figure is read from an
 * existing endpoint; what none supplies is left out (see the change report).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { groupByRun, useFeed } from "@/lib/api/next/monitor";
import { getForesight } from "@/lib/api/v2/aletheia-engine";
import { useHref } from "../load/common";
import { acknowledgeBreak, getLearnedMonitors, type BreakMetric, type LearnedBreak } from "@/lib/api/v2/learned-monitors";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { describeField } from "@/lib/v2/sap-fields";
import { BandChart, BarList, Button, Card, Chip, EmptyState, FieldChip, ScoreRuler, SeverityPill, Skeleton, StatTile, useToast } from "@/ui/kit";
import { compactCount, score } from "../object/format";
import { day, sevLabel, sevOf, useQ } from "./shared";
import "./monitorboard.css";

const SEV = ["critical", "high", "medium", "low"] as const;
const kindText = (k: LearnedBreak["kind"]): string => ({
  field_emptied: t("Field emptied"), fail_rate_jump: t("Fail rate jump"), format_break: t("Format break"), volume_drop: t("Volume drop"),
  volume_spike: t("Volume spike"), pattern_shift: t("Pattern shift"), range_shift: t("Range shift"), score_drop: t("Score drop"), cardinality_shift: t("Cardinality shift"),
})[k];
const unitText = (m: BreakMetric): string => ({
  blank_pct: t("% empty"), fail_rate: t("% failing"), unparse_pct: t("% bad format"), pattern_pct: t("% off pattern"), distinct_pct: t("% distinct"),
  records: t("records"), score: t("points"), num_mean: "", num_max: "", num_min: "", date_max: "", date_min: "",
})[m];
/** Metrics whose figure is a plain number on a scale a band can show; num_* and date_* are read from the explanation. */
const banded = (b: LearnedBreak) => b.expected_low !== null && b.expected_high !== null && !b.metric.startsWith("num_") && !b.metric.startsWith("date_");
const fmt = (b: LearnedBreak, n: number) => (b.metric === "records" ? compactCount(n) : score(n));

function Band({ b }: { b: LearnedBreak }) {
  const lo = b.expected_low ?? 0, hi = b.expected_high ?? 0;
  const min = Math.min(lo, b.observed), max = Math.max(hi, b.observed), span = max - min || 1;
  const at = (n: number) => `${((n - min) / span) * 100}%`;
  return (
    <div className="mb-band" data-sev={b.severity} role="img" aria-label={t("Usual range {a} to {b}, this run {c}", { a: fmt(b, lo), b: fmt(b, hi), c: fmt(b, b.observed) })}>
      <span className="mb-usual" style={{ insetInlineStart: at(lo), inlineSize: `${((hi - lo) / span) * 100}%` }} />
      <span className="mb-dot" style={{ insetInlineStart: at(b.observed) }} />
    </div>
  );
}

function Monitor1({ b, onAck }: { b: LearnedBreak; onAck: (id: string) => void }) {
  const href = useHref();
  const code = b.subject_code;
  const isField = code.includes(".");
  const desc = b.subject_description ?? (isField ? describeField(code) ?? undefined : undefined);
  const done = b.status === "acknowledged";
  return (
    <li className="mb-row" data-testid="monitor-break">
      <div className="mb-line">
        <SeverityPill sev={sevOf(b.severity)} label={sevLabel(b.severity)} />
        <span className="mb-kind">{kindText(b.kind)}</span>
        {code && code !== b.module ? <FieldChip code={code} description={desc ?? moduleText(b.module)} /> : <span className="mb-obj">{moduleText(b.module)}</span>}
      </div>
      {banded(b) ? (
        <>
          <Band b={b} />
          <div className="mb-figs">
            <span>{t("Usual {a} to {b}", { a: fmt(b, b.expected_low ?? 0), b: fmt(b, b.expected_high ?? 0) })}</span>
            <span className="mb-obs">{fmt(b, b.observed)} {unitText(b.metric)}</span>
            {b.median !== null ? <span>{t("median {n}", { n: fmt(b, b.median) })}</span> : null}
          </div>
        </>
      ) : <p className="mb-note">{b.explanation?.sentences?.[0] ?? ""}</p>}
      <div className="mb-actions">
        {done ? <span className="mb-note">{t("Acknowledged")}{b.decided_by ? `, ${b.decided_by}` : ""}</span> : <Button variant="ghost" onClick={() => onAck(b.id)}>{t("Acknowledge")}</Button>}
        <Button variant="ghost" href={href(`/work?module=${encodeURIComponent(b.module)}`)}>{t("Open")}</Button>
      </div>
    </li>
  );
}

export function MonitorBoard() {
  useInterfaceLang();
  const href = useHref();
  const toast = useToast();
  const qc = useQueryClient();
  const mon = useQ("learned", getLearnedMonitors);
  const fore = useQ("aletheia-foresight", getForesight);
  const feed = useFeed({ limit: 200 });
  const [mod, setMod] = useState("");
  if (mon.isLoading) return <Skeleton lines={5} label={t("Loading the monitor")} />;

  const d = mon.data;
  const mods = Array.from(new Set((d?.coverage ?? []).map((c) => c.module)));
  const all = (d?.breaks ?? []).filter((b) => !mod || b.module === mod);
  const quiet = (d?.below_minimum ?? []).filter((b) => !mod || b.module === mod);
  const open = all.filter((b) => b.status !== "acknowledged");
  const count = (s: string) => open.filter((b) => b.severity === s).length;
  const last = all.map((b) => b.detected_at).sort().pop();
  const ack = (ids: string[]) => Promise.all(ids.map((id) => acknowledgeBreak(id)))
    .then(() => { toast(t("Saved.")); void qc.invalidateQueries({ queryKey: ["b8", "learned"] }); })
    .catch(() => toast(t("That could not be saved."), "bad"));
  const lows = open.filter((b) => b.severity === "low");

  const f = fore.data;
  const runs = (f?.runs ?? []).filter((r) => r.composite != null);
  const normal = f?.engine?.normal;
  const chart = runs.map((r) => ({ axis: r.label ?? day(r.run_at), value: r.composite, low: normal?.low ?? null, high: normal?.high ?? null }));
  const latest = runs.length ? (runs[runs.length - 1].composite ?? 0) : null;
  const perRun = groupByRun(feed.data?.items ?? [], feed.data?.runs ?? []).slice(0, 8).reverse();

  return (
    <section className="mb-board" aria-label={t("Monitor at a glance")} data-testid="monitor-board">
      {mods.length > 1 && (
        <div className="mx-chips" role="group" aria-label={t("Object")}>
          <Chip selected={mod === ""} onClick={() => setMod("")}>{t("All objects")}</Chip>
          {mods.map((m) => <Chip key={m} selected={m === mod} onClick={() => setMod(m)}>{labelText(m)}</Chip>)}
        </div>
      )}
      {!d || (d.coverage.length === 0 && d.breaks.length === 0) ? (
        <EmptyState heading={t("Still learning")} body={t("A monitor needs several runs before it can tell a break from normal.")} />
      ) : (
        <>
          <Card title={t("Monitors breaking")} sub={last ? t("Checked on every run, last {when}", { when: day(last) }) : t("Checked on every run")}
            action={<span className="mb-actions">
              <Button variant="secondary" disabled={lows.length === 0} onClick={() => void ack(lows.map((b) => b.id))}>{t("Acknowledge all low")}</Button>
              <Button variant="primary" href={href(mod ? `/work?module=${encodeURIComponent(mod)}` : "/work")}>{t("Clean what broke")}</Button>
            </span>}>
            <dl className="mx-tiles">
              <StatTile label={t("Monitors breaking")} value={String(open.length)} />
              {SEV.map((s) => <StatTile key={s} label={sevLabel(s)} value={String(count(s))} />)}
              <StatTile label={t("Acknowledged")} value={t("{a} of {b}", { a: all.length - open.length, b: all.length })} />
            </dl>
          </Card>

          <Card title={t("Learned monitors")} sub={t("Usual range learned from the median of earlier runs. Band is usual, dot is this run")}>
            {all.length === 0 ? <EmptyState heading={t("No breaks")} body={t("Every watched value sits inside its learned range.")} /> : (
              <ul className="mb-list" aria-label={t("Learned monitors")}>
                {all.map((b) => <Monitor1 key={b.id} b={b} onAck={(id) => void ack([id])} />)}
              </ul>
            )}
          </Card>

          <div className="mb-grid">
            <Card title={t("Score after load")} sub={normal?.low != null && normal.high != null ? t("Usual {a} to {b}, gate 85", { a: score(normal.low), b: score(normal.high) }) : t("Gate 85")}>
              {chart.length >= 2 && f ? (
                <div className="mb-stack">
                  <BandChart label={t("Score per run against its usual band")} data={chart} target={85} />
                  {latest !== null ? <ScoreRuler ariaLabel={t("Latest score on the ruler, gates at 70 and 85")} marks={[{ id: "now", label: t("Score now"), shown: latest }]} showName={false}
                    labels={{ atRisk: t("At risk"), go: t("Go"), cap70: t("Gate 70, critical cap"), cap85: t("Gate 85, go"), measured: (n) => t("Measured {n}", { n }) }} /> : null}
                </div>
              ) : <EmptyState heading={t("Not enough runs yet")} />}
            </Card>
            <Card title={t("New findings per run")} sub={t("Rule findings that appeared or got worse")}>
              {perRun.length === 0 ? <EmptyState heading={t("Nothing new since the last run")} /> : (
                <BarList label={t("New findings per run")} items={perRun.map((g) => {
                  const n = g.newCount + g.regressedCount;
                  const worst = SEV.find((s) => g.findings.some((x) => x.severity === s));
                  return { id: g.version_id, label: g.label || g.version_id, value: n, display: String(n), sev: worst ? sevOf(worst) : undefined };
                })} />
              )}
            </Card>
          </div>

          <Card title={t("Quiet breaks")} sub={t("Stored, not alerted")}>
            {quiet.length === 0 ? <EmptyState heading={t("No quiet breaks")} /> : (
              <ul className="mb-list" aria-label={t("Quiet breaks")}>
                {quiet.map((b) => (
                  <li key={b.id} className="mb-row">
                    <div className="mb-line">
                      {b.subject_code && b.subject_code !== b.module ? <FieldChip code={b.subject_code} description={b.subject_description ?? describeField(b.subject_code) ?? moduleText(b.module)} /> : <span className="mb-obj">{moduleText(b.module)}</span>}
                      <span className="mb-kind">{kindText(b.kind)}</span>
                    </div>
                    <p className="mb-note">{b.explanation?.sentences?.[0] ?? ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
