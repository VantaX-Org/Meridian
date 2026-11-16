"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getBottlenecks, getCapacity, getPredictive, getPrescriptive, getSprintPlan,
  type Bottleneck, type DqsForecast, type EarlyWarning, type PlanAction, type Predictive, type Prescriptive, type Sprint,
} from "@/lib/api/v2/analytics";
import { formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { DataTable, Sparkline, StatCard, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend } from "../viz";
import { Banner, Block, HBars, Sev, status, useLift, useRuleName } from "./parts";

/**
 * Forecast and plan (api/routes/analytics.py): where each object's score is heading against its floor, the open work
 * ranked by what an hour of it is worth and filled into sprints, and whether the stewards can keep up with the queue.
 * Every figure is the backend's; a value it has not computed shows as a dash.
 */

const SIGNAL: Record<EarlyWarning["reason"], () => string> = {
  below_threshold: () => t("Below its floor"),
  projected_below_threshold: () => t("Heading below its floor within 30 days"),
  healthy: () => t("Holding above its floor"),
};

const TREND: Record<DqsForecast["trend"], () => string> = {
  improving: () => t("Improving"),
  stable: () => t("Stable"),
  declining: () => t("Declining"),
  critical: () => t("Falling fast"),
};

const STAGE: Record<string, () => string> = {
  detected: () => t("Waiting for a fix to be proposed"),
  recommended: () => t("Waiting for approval"),
  approved: () => t("Approved, waiting to be applied"),
};

const KIND: Record<PlanAction["type"], () => string> = {
  finding: () => t("Failing rule"),
  cleaning: () => t("Cleaning item"),
  exception: () => t("Exception"),
};

const HOURS = [16, 40, 80];
const hours = (n: number | null | undefined) => (n == null ? f1(null) : t("{n} h", { n: f1(n) }));
const range = (lo: number | null, hi: number | null) => (lo == null || hi == null ? f1(null) : t("{lo} to {hi}", { lo: f1(lo), hi: f1(hi) }));
const cost = (n: number | null, currency: string | null) => (n == null ? f1(null) : money(n, currency ?? ""));
const NO_HISTORY: Predictive = { forecasts: [], early_warnings: [], runs_seen: 0, days_seen: 0, reason: "no_history" };
const ORDER = { red: 0, amber: 1, green: 2 };

function Warnings({ p }: { p: Predictive }) {
  const rows = [...p.early_warnings].sort((a, b) => ORDER[a.signal] - ORDER[b.signal]);
  const fc = (id: string) => p.forecasts.find((x) => x.module_id === id);
  const cols: Column<EarlyWarning>[] = [
    { id: "object", label: t("Object"), cell: (w) => formatModuleName(w.module_id) },
    { id: "signal", label: t("Signal"), cell: (w) => SIGNAL[w.reason]() },
    { id: "floor", label: t("Floor"), align: "end", cell: (w) => f1(w.threshold) },
    { id: "now", label: t("Score now"), align: "end", cell: (w) => f1(fc(w.module_id)?.current_score ?? null) },
    {
      id: "spark", label: t("Last 4 weeks"), cell: (w) => {
        const f = fc(w.module_id);
        if (!f) return f1(null);
        return (
          <span className="nx-cell-stack">
            <Sparkline points={f.history.map((h) => h.score)} label={t("{object} score over the last {n} days", { object: formatModuleName(w.module_id), n: int(f.span_days) })} />
            <span className="nx-sub">{TREND[f.trend]()}</span>
          </span>
        );
      },
    },
    { id: "d30", label: t("In 30 days"), align: "end", cell: (w) => { const f = fc(w.module_id); return <span className="nx-cell-stack">{f1(f?.forecast_30d ?? null)}<span className="nx-sub">{range(f?.forecast_30d_low ?? null, f?.forecast_30d_high ?? null)}</span></span>; } },
    { id: "d90", label: t("In 90 days"), align: "end", cell: (w) => { const f = fc(w.module_id); return <span className="nx-cell-stack">{f1(f?.forecast_90d ?? null)}<span className="nx-sub">{range(f?.forecast_90d_low ?? null, f?.forecast_90d_high ?? null)}</span></span>; } },
  ];
  return (
    <Block title={t("Where each score is heading")} meta={t("Today, in 30 days and in 90 days, each with its 95% range")} testId="fc-warnings">
      {rows.length === 0 ? (
        <p className="nx-sub">{p.reason === "needs_three_days" ? t("Three days of scores are needed to forecast; there are {n}.", { n: int(p.days_seen) }) : t("No object has been scored on enough days to forecast.")}</p>
      ) : (
        <>
          <HBars label={t("Score in 30 days against the floor")} testId="fc-warning-bars" bars={rows.map((w) => {
            const v = fc(w.module_id)?.forecast_30d ?? null;
            return { key: w.module_id, label: formatModuleName(w.module_id), value: v ?? 0, text: f1(v), tone: w.signal === "red" ? "bad" : w.signal === "amber" ? "warn" : "good" };
          })} />
          <DataTable rows={rows} columns={cols} rowKey={(w) => w.module_id} rowLabel={(w) => formatModuleName(w.module_id)} caption={t("Where each score is heading")} />
        </>
      )}
    </Block>
  );
}

function Actions({ d }: { d: Prescriptive | null }) {
  const rule = useRuleName();
  const cols: Column<PlanAction>[] = [
    { id: "work", label: t("Work"), cell: (a) => (a.type === "finding" && a.check_id ? rule(a.check_id) : a.title) },
    { id: "kind", label: t("Kind"), cell: (a) => KIND[a.type]() },
    { id: "object", label: t("Object"), cell: (a) => (a.module ? formatModuleName(a.module) : f1(null)) },
    { id: "sev", label: t("Severity"), cell: (a) => <Sev severity={a.severity} /> },
    { id: "records", label: t("Records"), align: "end", cell: (a) => int(a.affected_count), compare: (a, b) => a.affected_count - b.affected_count },
    { id: "effort", label: t("Effort"), align: "end", cell: (a) => hours(a.effort_hours) },
    { id: "vph", label: t("Value an hour"), align: "end", cell: (a) => f1(a.value_per_hour), compare: (a, b) => (a.value_per_hour ?? 0) - (b.value_per_hour ?? 0) },
    { id: "cost", label: t("Cost"), align: "end", cell: (a) => cost(a.estimated_cost, a.currency) },
  ];
  const meta = d && d.total_actions > d.actions.length
    ? t("The first {n} of {total}", { n: int(d.actions.length), total: int(d.total_actions) })
    : t("Ranked by severity-weighted records fixed an hour");
  return (
    <Block title={t("Next best work")} meta={meta} testId="fc-actions">
      {!d || d.actions.length === 0 ? <p className="nx-sub">{t("No open work to plan.")}</p>
        : <DataTable rows={d.actions} columns={cols} rowKey={(a) => `${a.type}:${a.id}`} rowLabel={(a) => a.title} caption={t("Next best work")} />}
    </Block>
  );
}

function Sprints({ d }: { d: Prescriptive | null }) {
  const cols: Column<Sprint>[] = [
    { id: "n", label: t("Sprint"), cell: (s) => t("Sprint {n}", { n: int(s.sprint_number) }) },
    { id: "items", label: t("Work items"), align: "end", cell: (s) => int(s.actions.length) },
    { id: "effort", label: t("Effort"), align: "end", cell: (s) => hours(s.total_effort_hours) },
    { id: "fixed", label: t("Records fixed"), align: "end", cell: (s) => int(s.records_fixed) },
    { id: "crit", label: t("Critical cleared"), align: "end", cell: (s) => int(s.critical_cleared) },
    { id: "score", label: t("Score"), align: "end", cell: (s) => (s.dqs_now == null || s.dqs_projected == null ? f1(null) : t("{a} to {b}", { a: f1(s.dqs_now), b: f1(s.dqs_projected) })) },
    { id: "cost", label: t("Cost"), align: "end", cell: (s) => cost(s.estimated_cost, s.currency) },
  ];
  const a = d?.assumptions;
  return (
    <Block title={t("Sprint plan")} meta={a ? t("Sprints of {n} hours, {m} minutes a record", { n: f1(Number(a.sprint_hours)), m: f1(Number(a.minutes_per_record)) }) : undefined} testId="fc-sprints">
      {!d || d.sprints.length === 0 ? <p className="nx-sub">{t("No open work to plan.")}</p>
        : <DataTable rows={d.sprints} columns={cols} rowKey={(s) => String(s.sprint_number)} rowLabel={(s) => t("Sprint {n}", { n: int(s.sprint_number) })} caption={t("Sprint plan")} />}
    </Block>
  );
}

function Planner() {
  const [h, setH] = useState(40);
  const q = useLift(["forecast", "sprints", h], () => getSprintPlan(h), { sprints: [], total_actions: 0, assumptions: {} });
  const d = q.data;
  const cols: Column<Sprint>[] = [
    { id: "n", label: t("Sprint"), cell: (s) => int(s.sprint_number) },
    { id: "actions", label: t("Actions"), align: "end", cell: (s) => int(s.actions.length) },
    { id: "hours", label: t("Hours"), align: "end", cell: (s) => f1(s.total_effort_hours) },
    { id: "fixed", label: t("Records fixed"), align: "end", cell: (s) => int(s.records_fixed) },
    { id: "crit", label: t("Critical cleared"), align: "end", cell: (s) => int(s.critical_cleared) },
    { id: "cost", label: t("Cost"), align: "end", cell: (s) => cost(s.estimated_cost, s.currency) },
    { id: "now", label: t("Score now"), align: "end", cell: (s) => f1(s.dqs_now) },
    { id: "after", label: t("Score after"), align: "end", cell: (s) => f1(s.dqs_projected) },
  ];
  const trend = (d?.sprints ?? []).filter((s) => s.dqs_projected != null).map((s) => ({ label: t("Sprint {n}", { n: int(s.sprint_number) }), value: s.dqs_projected as number }));
  return (
    <Block title={t("Sprint planner")} meta={t("The plan cut into sprints of a set length")} testId="fc-sprint-planner">
      <label className="nx-ins-actions">
        <span className="nx-sub">{t("Hours in a sprint")}</span>
        <select className="nx-input" value={h} onChange={(e) => setH(Number(e.target.value))} data-testid="fc-sprint-hours" aria-label={t("Hours in a sprint")}>
          {HOURS.map((x) => <option key={x} value={x}>{int(x)}</option>)}
        </select>
      </label>
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={!d || d.sprints.length === 0}
        emptyHeading={t("No actions are waiting, so there is nothing to plan.")} label={t("Sprint planner")}>
        {d ? (
          <>
            <p className="nx-sub">{t("{n} actions in {s} sprints", { n: int(d.total_actions), s: int(d.sprints.length) })}</p>
            <AreaTrend points={trend} label={t("Projected score after each sprint")} empty={t("No actions are waiting, so there is nothing to plan.")} />
            <DataTable rows={d.sprints} columns={cols} rowKey={(s) => String(s.sprint_number)} rowLabel={(s) => t("Sprint {n}", { n: int(s.sprint_number) })} caption={t("Sprint planner")} />
          </>
        ) : null}
      </QueryView>
    </Block>
  );
}

function Queue() {
  const neck = useLift(["forecast", "bottlenecks"], getBottlenecks, { bottlenecks: [], total_queue_size: 0 });
  const cap = useLift(["forecast", "capacity"], getCapacity, { needed: null, current: 0, surplus_deficit: null, daily_inflow: null, per_steward: null, reason: "no_inflow" as const });
  const c = cap.data;
  const d = neck.data;
  const dash = () => f1(null);
  const cols: Column<Bottleneck>[] = [
    { id: "stage", label: t("Stage"), cell: (b) => STAGE[b.stage]?.() ?? b.stage },
    { id: "count", label: t("Items"), align: "end", cell: (b) => int(b.count), compare: (a, b) => a.count - b.count },
    { id: "wait", label: t("Average wait"), align: "end", cell: (b) => hours(b.avg_age_hours), compare: (a, b) => a.avg_age_hours - b.avg_age_hours },
  ];
  return (
    <Block title={t("Can the stewards keep up")} meta={d ? t("{n} items open in the cleaning queue", { n: int(d.total_queue_size) }) : undefined} testId="fc-queue">
      <QueryView loading={neck.isPending} error={neck.error} onRetry={() => void neck.refetch()} empty={false} emptyHeading="" label={t("Can the stewards keep up")}>
        {c ? (
          <div className="nx-statgrid" data-testid="fc-capacity">
            <StatCard label={t("Stewards needed")} value={c.needed ?? 0} format={c.needed == null ? dash : int} />
            <StatCard label={t("Stewards working")} value={c.current} />
            <StatCard label={t("New items a day")} value={c.daily_inflow ?? 0} format={c.daily_inflow == null ? dash : f1} />
            <StatCard label={t("Items a steward clears a day")} value={c.per_steward ?? 0} format={c.per_steward == null ? dash : f1} />
          </div>
        ) : null}
        {c?.reason ? <p className="nx-sub">{c.reason === "no_stewards" ? t("No steward has recorded work yet, so capacity cannot be planned.") : t("No new items have been recorded yet, so capacity cannot be planned.")}</p> : null}
        {!d || d.bottlenecks.length === 0 ? <p className="nx-sub">{t("No queue stage is backed up.")}</p> : (
          <>
            <HBars label={t("Backed-up stages")} bars={d.bottlenecks.map((b) => ({ key: b.stage, label: STAGE[b.stage]?.() ?? b.stage, value: b.count, text: int(b.count), tone: "warn" }))} />
            <DataTable rows={d.bottlenecks} columns={cols} rowKey={(b) => b.stage} rowLabel={(b) => STAGE[b.stage]?.() ?? b.stage} caption={t("Backed-up stages")} />
          </>
        )}
      </QueryView>
    </Block>
  );
}

export function Forecast() {
  const pred = useLift(["forecast", "predictive"], getPredictive, NO_HISTORY);
  const plan = useLift(["forecast", "prescriptive"], getPrescriptive, null as Prescriptive | null);
  const denied = pred.isError && status(pred.error) === 403;
  const p = pred.data;
  const red = p?.early_warnings.filter((w) => w.signal === "red") ?? [];
  const amber = p?.early_warnings.filter((w) => w.signal === "amber") ?? [];
  const sprints = plan.data?.sprints ?? [];
  const first = sprints[0];
  const last = sprints.at(-1);
  const headline = red.length
    ? red.length === 1 ? t("{object} is below its floor", { object: formatModuleName(red[0].module_id) }) : t("{n} objects are below their floor", { n: int(red.length) })
    : amber.length
      ? amber.length === 1 ? t("{object} is heading below its floor", { object: formatModuleName(amber[0].module_id) }) : t("{n} objects are heading below their floor", { n: int(amber.length) })
      : p?.early_warnings.length ? t("Every object holds above its floor") : t("No object has enough history to forecast");
  const projected = sprints.filter((s) => s.dqs_projected != null).map((s) => ({ label: t("Sprint {n}", { n: int(s.sprint_number) }), value: s.dqs_projected as number }));
  const fixed = sprints.map((s) => ({ label: t("Sprint {n}", { n: int(s.sprint_number) }), value: s.records_fixed }));
  return (
    <div className="nx-body" data-testid="ins-forecast">
      <p className="nx-sub">{t("Projects each score from its history and ranks the open work that would lift it fastest.")}</p>
      {denied ? <p className="nx-sub" role="alert">{t("Your role cannot read the forecast.")}</p> : (
        <QueryView loading={pred.isPending} error={pred.isError ? t("The forecast could not be read.") : null} onRetry={() => void pred.refetch()} empty={false} emptyHeading="" label={t("Forecast and plan")}>
          {p ? (
            <>
              <Banner
                eyebrow={t("Forecast and plan")}
                verdict={red.length ? "no-go" : amber.length ? "at-risk" : p.early_warnings.length ? "go" : undefined}
                headline={headline}
                why={t("Each score is projected from its daily history with a 95% range. The plan ranks open work by severity-weighted records fixed an hour and fills it into sprints of the stated hours.")}
                figs={[
                  { label: t("Below the floor"), value: red.length },
                  { label: t("Heading below"), value: amber.length },
                  { label: t("Sprints to clear the open work"), value: plan.data ? sprints.length : null },
                  { label: t("Score after the plan"), value: last?.dqs_projected ?? null, format: f1, note: first?.dqs_now != null ? t("from {n} now", { n: f1(first.dqs_now) }) : undefined },
                ]}
                testId="fc-banner"
              />
              <div className="nx-chartcards">
                <ChartCard title={t("Projected score after each sprint")} state={cardState(plan, projected.length === 0)} figure={last?.dqs_projected != null ? f1(last.dqs_projected) : undefined}
                  emptyLine={t("No open work to plan.")}
                  chart={<AreaTrend points={projected} label={t("Projected score after each sprint")} empty={t("No open work to plan.")} />} />
                <ChartCard title={t("Records fixed per sprint")} state={cardState(plan, fixed.length === 0)} figure={fixed.length ? int(fixed.reduce((a, s) => a + s.value, 0)) : undefined}
                  emptyLine={t("No open work to plan.")}
                  chart={<AreaTrend points={fixed} label={t("Records fixed per sprint")} empty={t("No open work to plan.")} />} />
              </div>
              <Warnings p={p} />
              <QueryView loading={plan.isPending} error={plan.error} onRetry={() => void plan.refetch()} empty={false} emptyHeading="" label={t("Next best work")}>
                <Actions d={plan.data ?? null} />
                <Sprints d={plan.data ?? null} />
              </QueryView>
              <Planner />
              <Queue />
              <p><Link href="/work">{t("Open the work queue")}</Link></p>
            </>
          ) : null}
        </QueryView>
      )}
    </div>
  );
}
