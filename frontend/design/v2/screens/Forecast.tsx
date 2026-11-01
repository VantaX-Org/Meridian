"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBottlenecks, getCapacity, getPredictive, getPrescriptive, type DqsForecast, type EarlyWarning, type PlanAction } from "@/lib/api/v2/analytics";
import { formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Sparkline } from "../charts";
import { Sev } from "../inspector/rule";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { retry, Section, status, Table, useRuleName } from "./WorkAnalytics";

/**
 * Forecast and plan: where each object's score is heading against its floor, the open work ranked by what an hour
 * of it is worth and filled into sprints, and whether the stewards can keep up with the queue
 * (api/routes/analytics.py). Every figure is the backend's; a value it has not computed shows as a dash.
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

const hours = (n: number | null | undefined) => (n == null ? f1(null) : t("{n} h", { n: f1(n) }));
const range = (lo: number | null, hi: number | null) => (lo == null || hi == null ? f1(null) : t("{lo} to {hi}", { lo: f1(lo), hi: f1(hi) }));

/** A 404 means nothing has been scored yet: the page shows it as empty, not as an error. */
function usePlan<T>(key: string, fn: () => Promise<T>, empty: T) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["forecast", key, fixture],
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

export function Forecast() {
  const pred = usePlan("predictive", getPredictive, { forecasts: [], early_warnings: [], runs_seen: 0, days_seen: 0, reason: "no_history" as const });
  const plan = usePlan("prescriptive", getPrescriptive, null);

  if (pred.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (pred.isError) {
    return (
      <CcPage>
        {status(pred.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the forecast.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void pred.refetch()}>{t("The forecast could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
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
    <CcPage>
      <CcBanner
        eyebrow={t("Forecast and plan")}
        verdict={red.length ? "no-go" : amber.length ? "at-risk" : p.early_warnings.length ? "go" : undefined}
        headline={headline}
        why={t("Each score is projected from its daily history with a 95% range. The plan ranks open work by severity-weighted records fixed an hour and fills it into sprints of the stated hours.")}
        figs={[
          { label: t("Below the floor"), value: int(red.length) },
          { label: t("Heading below"), value: int(amber.length) },
          { label: t("Sprints to clear the open work"), value: plan.data ? int(plan.data.sprints.length) : f1(null) },
          { label: t("Score after the plan"), value: f1(last?.dqs_projected ?? null), note: first?.dqs_now != null ? t("from {n} now", { n: f1(first.dqs_now) }) : undefined },
        ]}
        testId="fc-banner"
        label={t("Forecast and plan")}
      />
      <WarningsPanel forecasts={p.forecasts} warnings={p.early_warnings} reason={p.reason} days={p.days_seen} />
      <ActionsPanel q={plan} />
      <SprintsPanel q={plan} />
      <QueuePanel />
    </CcPage>
  );
}

function WarningsPanel({ forecasts, warnings, reason, days }: { forecasts: DqsForecast[]; warnings: EarlyWarning[]; reason?: string; days: number }) {
  const title = t("Where each score is heading");
  const order = { red: 0, amber: 1, green: 2 };
  const rows = [...warnings].sort((a, b) => order[a.signal] - order[b.signal]);
  const q = { isPending: false, isError: false, error: null, data: rows, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Today, in 30 days and in 90 days, each with its 95% range")} testId="fc-warnings">
      {(d) => d.length === 0 ? (
        <EmptyFrame>
          {reason === "needs_three_days" ? t("Three days of scores are needed to forecast; there are {n}.", { n: int(days) }) : t("No object has been scored on enough days to forecast.")}
        </EmptyFrame>
      ) : (
        <Table title={title} head={[t("Object"), t("Signal"), t("Floor"), t("Score now"), t("Last 4 weeks"), t("In 30 days"), t("In 90 days")]}>
          {d.map((w) => {
            const f = forecasts.find((x) => x.module_id === w.module_id);
            return (
              <tr key={w.module_id}>
                <th scope="row" className="m2-card-lead">{formatModuleName(w.module_id)}</th>
                <td data-label={t("Signal")} className="m2-wrap">{SIGNAL[w.reason]()}</td>
                <td data-label={t("Floor")} className="m2-num">{f1(w.threshold)}</td>
                <td data-label={t("Score now")} className="m2-num">{f1(f?.current_score ?? null)}</td>
                <td data-label={t("Last 4 weeks")}>
                  {f && f.history.length > 1 ? <Sparkline values={f.history.map((h) => h.score)} label={t("{object} score over the last {n} days", { object: formatModuleName(w.module_id), n: int(f.span_days) })} width={72} height={16} /> : f1(null)}
                  {f ? <span className="m2-under">{TREND[f.trend]()}</span> : null}
                </td>
                <td data-label={t("In 30 days")} className="m2-num">
                  {f1(f?.forecast_30d ?? null)}<span className="m2-under">{range(f?.forecast_30d_low ?? null, f?.forecast_30d_high ?? null)}</span>
                </td>
                <td data-label={t("In 90 days")} className="m2-num">
                  {f1(f?.forecast_90d ?? null)}<span className="m2-under">{range(f?.forecast_90d_low ?? null, f?.forecast_90d_high ?? null)}</span>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

type Plan = Awaited<ReturnType<typeof getPrescriptive>> | null;
type Q<T> = { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };

function ActionsPanel({ q }: { q: Q<Plan> }) {
  const rule = useRuleName();
  const title = t("Next best work");
  return (
    <Section q={q} title={title} meta={t("Ranked by severity-weighted records fixed an hour")} testId="fc-actions">
      {(d) => !d || d.actions.length === 0 ? <EmptyFrame>{t("No open work to plan.")}</EmptyFrame> : (
        <Table title={title} head={[t("Work"), t("Kind"), t("Object"), t("Severity"), t("Records"), t("Effort"), t("Value an hour"), t("Cost")]}>
          {d.actions.map((a) => (
            <tr key={`${a.type}:${a.id}`}>
              <th scope="row" className="m2-card-lead">{a.type === "finding" && a.check_id ? rule(a.check_id) : a.title}</th>
              <td data-label={t("Kind")}>{KIND[a.type]()}</td>
              <td data-label={t("Object")}>{a.module ? formatModuleName(a.module) : f1(null)}</td>
              <td data-label={t("Severity")}><Sev severity={a.severity} /></td>
              <td data-label={t("Records")} className="m2-num">{int(a.affected_count)}</td>
              <td data-label={t("Effort")} className="m2-num">{hours(a.effort_hours)}</td>
              <td data-label={t("Value an hour")} className="m2-num">{f1(a.value_per_hour)}</td>
              <td data-label={t("Cost")} className="m2-num">{a.estimated_cost == null ? f1(null) : money(a.estimated_cost, a.currency)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function SprintsPanel({ q }: { q: Q<Plan> }) {
  const title = t("Sprint plan");
  const meta = q.data ? t("Sprints of {n} hours, {m} minutes a record", { n: f1(q.data.assumptions.sprint_hours), m: f1(q.data.assumptions.minutes_per_record) }) : undefined;
  return (
    <Section q={q} title={title} meta={meta} testId="fc-sprints">
      {(d) => !d || d.sprints.length === 0 ? <EmptyFrame>{t("No open work to plan.")}</EmptyFrame> : (
        <Table title={title} head={[t("Sprint"), t("Work items"), t("Effort"), t("Records fixed"), t("Critical cleared"), t("Score"), t("Cost")]}>
          {d.sprints.map((s) => (
            <tr key={s.sprint_number}>
              <th scope="row" className="m2-card-lead">{t("Sprint {n}", { n: int(s.sprint_number) })}</th>
              <td data-label={t("Work items")} className="m2-num">{int(s.actions.length)}</td>
              <td data-label={t("Effort")} className="m2-num">{hours(s.total_effort_hours)}</td>
              <td data-label={t("Records fixed")} className="m2-num">{int(s.records_fixed)}</td>
              <td data-label={t("Critical cleared")} className="m2-num">{int(s.critical_cleared)}</td>
              <td data-label={t("Score")} className="m2-num">{s.dqs_now == null || s.dqs_projected == null ? f1(null) : t("{a} to {b}", { a: f1(s.dqs_now), b: f1(s.dqs_projected) })}</td>
              <td data-label={t("Cost")} className="m2-num">{s.estimated_cost == null ? f1(null) : money(s.estimated_cost, s.currency)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function QueuePanel() {
  const neck = usePlan("bottlenecks", getBottlenecks, { bottlenecks: [], total_queue_size: 0 });
  const cap = usePlan("capacity", getCapacity, { needed: null, current: 0, surplus_deficit: null, daily_inflow: null, per_steward: null, reason: "no_inflow" as const });
  const title = t("Can the stewards keep up");
  const c = cap.data;
  return (
    <Section q={neck} title={title} meta={neck.data ? t("{n} items open in the cleaning queue", { n: int(neck.data.total_queue_size) }) : undefined} testId="fc-queue">
      {(d) => (
        <>
          {c ? (
            <dl className="m2-cc-figs" data-testid="fc-capacity">
              <div><dt>{t("Stewards needed")}</dt><dd>{c.needed == null ? f1(null) : int(c.needed)}</dd></div>
              <div><dt>{t("Stewards working")}</dt><dd>{int(c.current)}</dd></div>
              <div><dt>{t("New items a day")}</dt><dd>{f1(c.daily_inflow)}</dd></div>
              <div><dt>{t("Items a steward clears a day")}</dt><dd>{f1(c.per_steward)}</dd></div>
            </dl>
          ) : null}
          {c?.reason ? <p className="m2-meta">{c.reason === "no_stewards" ? t("No steward has recorded work yet, so capacity cannot be planned.") : t("No new items have been recorded yet, so capacity cannot be planned.")}</p> : null}
          {d.bottlenecks.length === 0 ? <EmptyFrame>{t("No queue stage is backed up.")}</EmptyFrame> : (
            <Table title={t("Backed-up stages")} head={[t("Stage"), t("Items"), t("Average wait")]}>
              {d.bottlenecks.map((b) => (
                <tr key={b.stage}>
                  <th scope="row" className="m2-card-lead">{STAGE[b.stage]?.() ?? b.stage}</th>
                  <td data-label={t("Items")} className="m2-num">{int(b.count)}</td>
                  <td data-label={t("Average wait")} className="m2-num">{hours(b.avg_age_hours)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Section>
  );
}
