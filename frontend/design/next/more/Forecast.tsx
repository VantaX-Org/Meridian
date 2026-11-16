"use client";

import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBottlenecks, getCapacity, getPredictive, getPrescriptive, getSprintPlan, type DqsForecast, type EarlyWarning, type PlanAction, type Sprint } from "@/lib/api/v2/analytics";
import { formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, Sparkline, type ChipTone, type Column } from "../kit";
import { About, Banner, Figs, Fold, Panel } from "./cfg-parts";

/**
 * Forecast and plan: where each object's score is heading against its floor, the open work ranked by what an hour
 * of it is worth and filled into sprints, and whether the stewards can keep up with the queue
 * (api/routes/analytics.py). Every figure is the backend's; a value it has not computed shows as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

const SIGNAL: Record<EarlyWarning["reason"], () => string> = {
  below_threshold: () => t("Below its floor"),
  projected_below_threshold: () => t("Heading below its floor within 30 days"),
  healthy: () => t("Holding above its floor"),
};
const SIGNAL_TONE: Record<EarlyWarning["signal"], ChipTone> = { red: "bad", amber: "warn", green: "good" };

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

const SEV: Record<string, { word: () => string; tone: ChipTone }> = {
  critical: { word: () => t("Critical"), tone: "bad" },
  high: { word: () => t("High"), tone: "bad" },
  medium: { word: () => t("Medium"), tone: "warn" },
  low: { word: () => t("Low"), tone: "neutral" },
};

const hours = (n: number | null | undefined) => (n == null ? f1(null) : t("{n} h", { n: f1(n) }));
const range = (lo: number | null, hi: number | null) => (lo == null || hi == null ? f1(null) : t("{lo} to {hi}", { lo: f1(lo), hi: f1(hi) }));
const cost = (n: number | null, c: string) => (n == null ? f1(null) : money(n, c));

/** A 404 means nothing has been scored yet: the page shows it as empty, not as an error. */
function usePlan<T>(key: string, fn: () => Promise<T>, empty: T, extra: unknown[] = []) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["forecast", key, fixture, ...extra],
    queryFn: async () => {
      try {
        return await fn();
      } catch (e) {
        if (status(e) === 404) return empty;
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
}

/** Loading, refused and failed states for one panel. */
function Part<T>({ q, label, children }: { q: UseQueryResult<T, unknown>; label: string; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={4} label={label} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read the forecast.")} />
      : <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data)}</>;
}

export function Forecast() {
  const pred = usePlan("predictive", getPredictive, { forecasts: [], early_warnings: [], runs_seen: 0, days_seen: 0, reason: "no_history" as const });
  const plan = usePlan("prescriptive", getPrescriptive, null);
  const title = t("Forecast and plan");

  if (pred.isPending) return <Skeleton lines={8} label={title} />;
  if (pred.isError) {
    return status(pred.error) === 403
      ? <EmptyState heading={t("Your role cannot read the forecast.")} />
      : <ErrorState sentence={t("The forecast could not be read.")} onRetry={() => void pred.refetch()} />;
  }
  const p = pred.data;
  const red = p.early_warnings.filter((w) => w.signal === "red");
  const amber = p.early_warnings.filter((w) => w.signal === "amber");
  const first = plan.data?.sprints[0];
  const last = plan.data?.sprints.at(-1);
  const headline = red.length
    ? red.length === 1 ? t("{object} is below its floor", { object: formatModuleName(red[0].module_id) }) : t("{n} objects are below their floor", { n: int(red.length) })
    : amber.length
      ? amber.length === 1 ? t("{object} is heading below its floor", { object: formatModuleName(amber[0].module_id) }) : t("{n} objects are heading below their floor", { n: int(amber.length) })
      : p.early_warnings.length
        ? t("Every object holds above its floor")
        : t("No object has enough history to forecast");
  return (
    <div className="nx-body">
      <Banner
        testId="fc-banner"
        label={title}
        meta={title}
        title={headline}
        why={t("Each score is projected from its daily history with a 95% range. The plan ranks open work by severity-weighted records fixed an hour and fills it into sprints of the stated hours.")}
        figs={[
          { label: t("Below the floor"), value: int(red.length) },
          { label: t("Heading below"), value: int(amber.length) },
          { label: t("Sprints to clear the open work"), value: plan.data ? int(plan.data.sprints.length) : f1(null) },
          { label: t("Score after the plan"), value: f1(last?.dqs_projected ?? null), note: first?.dqs_now != null ? t("from {n} now", { n: f1(first.dqs_now) }) : undefined },
        ]}
      />
      <Warnings forecasts={p.forecasts} warnings={p.early_warnings} reason={p.reason} days={p.days_seen} />
      <Actions q={plan} />
      <Fold title={t("Sprint plan")} hint={t("Ranked by severity-weighted records fixed an hour")}>
        <Sprints q={plan} />
      </Fold>
      <Fold title={t("Sprint planner")} hint={t("The plan cut into sprints of a set length")}>
        <Planner />
      </Fold>
      <Fold title={t("Open work queue")} hint={t("Can the stewards keep up")}>
        <Queue />
      </Fold>
      <About
        shows={t("Projects each score from its history and ranks the open work that would lift it fastest.")}
        next={{ href: "/work", label: t("Open the work queue") }}
        why={t("Each score is projected from its daily history with a 95% range. The plan ranks open work by severity-weighted records fixed an hour and fills it into sprints of the stated hours.")}
        means={[
          [t("Below the floor"), t("Objects already under the lowest score you accept.")],
          [t("Heading below"), t("Objects forecast to fall under the floor within the range shown.")],
          [t("Sprints to clear the open work"), t("How many sprints of the stated hours the plan needs for all open work.")],
        ]}
      />
    </div>
  );
}

function Warnings({ forecasts, warnings, reason, days }: { forecasts: DqsForecast[]; warnings: EarlyWarning[]; reason?: string; days: number }) {
  const title = t("Where each score is heading");
  const order = { red: 0, amber: 1, green: 2 };
  const rows = [...warnings].sort((a, b) => order[a.signal] - order[b.signal]);
  const fc = (w: EarlyWarning) => forecasts.find((x) => x.module_id === w.module_id);
  const cols: Column<EarlyWarning>[] = [
    { id: "object", label: t("Object"), cell: (w) => <span data-testid={`fc-warn-${w.module_id}`}>{formatModuleName(w.module_id)}</span> },
    { id: "signal", label: t("Signal"), cell: (w) => <Chip tone={SIGNAL_TONE[w.signal]}>{SIGNAL[w.reason]()}</Chip> },
    { id: "floor", label: t("Floor"), align: "end", cell: (w) => f1(w.threshold) },
    { id: "now", label: t("Score now"), align: "end", cell: (w) => f1(fc(w)?.current_score ?? null) },
    {
      id: "trend",
      label: t("Last 4 weeks"),
      cell: (w) => {
        const f = fc(w);
        if (!f) return f1(null);
        return (
          <span>
            <Sparkline points={f.history.map((h) => h.score)} label={t("{object} score over the last {n} days", { object: formatModuleName(w.module_id), n: int(f.span_days) })} />
            <span className="nx-sub"> {TREND[f.trend]()}</span>
          </span>
        );
      },
    },
    { id: "d30", label: t("In 30 days"), align: "end", cell: (w) => { const f = fc(w); return <span>{f1(f?.forecast_30d ?? null)} <span className="nx-sub">{range(f?.forecast_30d_low ?? null, f?.forecast_30d_high ?? null)}</span></span>; } },
    { id: "d90", label: t("In 90 days"), align: "end", cell: (w) => { const f = fc(w); return <span>{f1(f?.forecast_90d ?? null)} <span className="nx-sub">{range(f?.forecast_90d_low ?? null, f?.forecast_90d_high ?? null)}</span></span>; } },
  ];
  return (
    <Panel title={title} meta={t("Today, in 30 days and in 90 days, each with its 95% range")} testId="fc-warnings">
      {rows.length === 0 ? (
        <EmptyState heading={reason === "needs_three_days" ? t("Three days of scores are needed to forecast; there are {n}.", { n: int(days) }) : t("No object has been scored on enough days to forecast.")} />
      ) : (
        <DataTable caption={title} rows={rows} rowKey={(w) => w.module_id} rowLabel={(w) => formatModuleName(w.module_id)} columns={cols} />
      )}
    </Panel>
  );
}

type Plan = Awaited<ReturnType<typeof getPrescriptive>> | null;

function Actions({ q }: { q: UseQueryResult<Plan, unknown> }) {
  const rules = useRuleList();
  // A rule's name is "CHECK_ID: text", so the text is the part after the colon.
  const names = new Map((rules.data?.rules ?? []).map((r) => {
    const i = r.name.indexOf(":");
    return i > 0 ? [r.name.slice(0, i), r.name.slice(i + 1).trim()] : [r.name, r.name];
  }));
  const title = t("Next best work");
  const d = q.data;
  const meta = d && d.total_actions > d.actions.length ? t("The first {n} of {total}", { n: int(d.actions.length), total: int(d.total_actions) }) : t("Ranked by severity-weighted records fixed an hour");
  return (
    <Panel title={title} meta={meta} testId="fc-actions">
      <Part q={q} label={title}>
        {(plan) => !plan || plan.actions.length === 0 ? <EmptyState heading={t("No open work to plan.")} /> : (
          <DataTable
            caption={title}
            rows={plan.actions}
            rowKey={(a) => `${a.type}:${a.id}`}
            rowLabel={(a) => a.title}
            columns={[
              { id: "work", label: t("Work"), cell: (a) => a.type === "finding" && a.check_id ? <Code code={a.check_id} text={names.get(a.check_id)} /> : a.title },
              { id: "kind", label: t("Kind"), cell: (a) => KIND[a.type]() },
              { id: "object", label: t("Object"), cell: (a) => (a.module ? formatModuleName(a.module) : f1(null)) },
              { id: "sev", label: t("Severity"), cell: (a) => { const s = SEV[a.severity.toLowerCase()]; return <Chip tone={s?.tone ?? "neutral"}>{s ? s.word() : a.severity}</Chip>; } },
              { id: "records", label: t("Records"), align: "end", cell: (a) => int(a.affected_count), compare: (x, y) => x.affected_count - y.affected_count },
              { id: "effort", label: t("Effort"), align: "end", cell: (a) => hours(a.effort_hours), compare: (x, y) => x.effort_hours - y.effort_hours },
              { id: "value", label: t("Value an hour"), align: "end", cell: (a) => f1(a.value_per_hour), compare: (x, y) => x.value_per_hour - y.value_per_hour },
              { id: "cost", label: t("Cost"), align: "end", cell: (a) => cost(a.estimated_cost, a.currency) },
            ]}
          />
        )}
      </Part>
    </Panel>
  );
}

function SprintTable({ title, sprints }: { title: string; sprints: Sprint[] }) {
  return (
    <DataTable
      caption={title}
      rows={sprints}
      rowKey={(s) => String(s.sprint_number)}
      rowLabel={(s) => t("Sprint {n}", { n: int(s.sprint_number) })}
      columns={[
        { id: "sprint", label: t("Sprint"), cell: (s) => t("Sprint {n}", { n: int(s.sprint_number) }) },
        { id: "items", label: t("Work items"), align: "end", cell: (s) => int(s.actions.length) },
        { id: "effort", label: t("Effort"), align: "end", cell: (s) => hours(s.total_effort_hours) },
        { id: "fixed", label: t("Records fixed"), align: "end", cell: (s) => int(s.records_fixed) },
        { id: "critical", label: t("Critical cleared"), align: "end", cell: (s) => int(s.critical_cleared) },
        { id: "score", label: t("Score"), align: "end", cell: (s) => (s.dqs_now == null || s.dqs_projected == null ? f1(null) : t("{a} to {b}", { a: f1(s.dqs_now), b: f1(s.dqs_projected) })) },
        { id: "cost", label: t("Cost"), align: "end", cell: (s) => cost(s.estimated_cost, s.currency) },
      ]}
    />
  );
}

function Sprints({ q }: { q: UseQueryResult<Plan, unknown> }) {
  const title = t("Sprint plan");
  const meta = q.data ? t("Sprints of {n} hours, {m} minutes a record", { n: f1(q.data.assumptions.sprint_hours), m: f1(q.data.assumptions.minutes_per_record) }) : undefined;
  return (
    <Panel title={title} meta={meta} testId="fc-sprints">
      <Part q={q} label={title}>
        {(d) => !d || d.sprints.length === 0 ? <EmptyState heading={t("No open work to plan.")} /> : <SprintTable title={title} sprints={d.sprints} />}
      </Part>
    </Panel>
  );
}

const HOURS = [16, 40, 80];

function Planner() {
  const [max, setMax] = useState(40);
  const q = usePlan("sprints", () => getSprintPlan(max), { sprints: [], total_actions: 0, assumptions: {} }, [max]);
  const title = t("Sprint planner");
  return (
    <Panel title={title} meta={t("The plan cut into sprints of a set length")} testId="fc-sprint-planner">
      <label className="nx-field">
        {t("Hours in a sprint")}
        <select className="nx-input" value={max} onChange={(e) => setMax(Number(e.target.value))} data-testid="fc-sprint-hours">
          {HOURS.map((h) => <option key={h} value={h}>{int(h)}</option>)}
        </select>
      </label>
      <Part q={q} label={title}>
        {(d) => d.sprints.length === 0 ? <EmptyState heading={t("No actions are waiting, so there is nothing to plan.")} /> : (
          <>
            <p className="nx-sub">
              {t("{n} actions in {s} sprints", { n: int(d.total_actions), s: int(d.sprints.length) })}{" "}
              <Sparkline points={d.sprints.flatMap((s) => (s.dqs_projected == null ? [] : [s.dqs_projected]))} label={t("Projected score after each sprint")} />
            </p>
            <SprintTable title={title} sprints={d.sprints} />
          </>
        )}
      </Part>
    </Panel>
  );
}

function Queue() {
  const neck = usePlan("bottlenecks", getBottlenecks, { bottlenecks: [], total_queue_size: 0 });
  const cap = usePlan("capacity", getCapacity, { needed: null, current: 0, surplus_deficit: null, daily_inflow: null, per_steward: null, reason: "no_inflow" as const });
  const title = t("Can the stewards keep up");
  const c = cap.data;
  return (
    <Panel title={title} meta={neck.data ? t("{n} items open in the cleaning queue", { n: int(neck.data.total_queue_size) }) : undefined} testId="fc-queue">
      <Part q={neck} label={title}>
        {(d) => (
          <>
            {c ? (
              <div data-testid="fc-capacity">
                <Figs
                  label={title}
                  figs={[
                    { label: t("Stewards needed"), value: c.needed == null ? f1(null) : int(c.needed) },
                    { label: t("Stewards working"), value: int(c.current) },
                    { label: t("New items a day"), value: f1(c.daily_inflow) },
                    { label: t("Items a steward clears a day"), value: f1(c.per_steward) },
                  ]}
                />
              </div>
            ) : null}
            {c?.reason ? <p className="nx-sub">{c.reason === "no_stewards" ? t("No steward has recorded work yet, so capacity cannot be planned.") : t("No new items have been recorded yet, so capacity cannot be planned.")}</p> : null}
            {d.bottlenecks.length === 0 ? <EmptyState heading={t("No queue stage is backed up.")} /> : (
              <DataTable
                caption={t("Backed-up stages")}
                rows={d.bottlenecks}
                rowKey={(b) => b.stage}
                rowLabel={(b) => b.stage}
                columns={[
                  { id: "stage", label: t("Stage"), cell: (b) => <Code code={b.stage} text={STAGE[b.stage]?.()} /> },
                  { id: "items", label: t("Items"), align: "end", cell: (b) => int(b.count) },
                  { id: "wait", label: t("Average wait"), align: "end", cell: (b) => hours(b.avg_age_hours) },
                ]}
              />
            )}
          </>
        )}
      </Part>
    </Panel>
  );
}
