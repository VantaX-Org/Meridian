"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getCauseClusters, getImpact, getProvenCost, getTrends, type ProvenCostRow } from "@/lib/api/v2/insights";
import { getEngineDrivers, type EngineDrivers, type EngineOffReason } from "@/lib/api/v2/aletheia-engine";
import { formatDate, formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { f1, int, pct1 } from "@/lib/v2/score";
import { ChartFrame, ChartTable, niceTicks, TrendChart } from "../charts";
import { Sev } from "../inspector/rule";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Disclose, Guide } from "./Guide";
import { CcBanner, CcPage } from "./cc-parts";
import { pctOf, retry, Section, status, Table, useRuleName } from "./WorkAnalytics";

/**
 * Cost and causes: what bad data costs per business area, which SAP features it puts at risk, and which fields the
 * failing rules share (api/routes/insights.py). Money is shown per business area only, never added across areas.
 */

const L1: Record<string, () => string> = {
  hire_to_retire: () => t("Hire to retire"),
  master_data: () => t("Master data"),
  order_to_cash: () => t("Order to cash"),
  plan_to_produce: () => t("Plan to produce"),
  procure_to_pay: () => t("Procure to pay"),
  record_to_report: () => t("Record to report"),
  unassigned: () => t("No business area"),
};
const area = (k: string | null) => L1[k ?? "unassigned"]?.() ?? k ?? f1(null);

const METRIC: Record<string, () => string> = {
  late_po: () => t("Late purchase orders (lead time and info record defects)"),
  grir_uom_variance: () => t("GR/IR variance (unit of measure defects)"),
  duplicate_payment: () => t("Duplicate vendor payments"),
  blocked_sales: () => t("Sales orders blocked (customer master)"),
};

const FEATURE_STATUS: Record<string, () => string> = {
  blocked: () => t("Blocked"),
  degraded: () => t("Degraded"),
  at_risk: () => t("At risk"),
};

/** A 404 means no run has been scored yet: the page shows it as empty, not as an error. */
function useInsight<T>(key: string, fn: () => Promise<T>, empty: T) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["insights", key, fixture],
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

/** blocking_findings carry check ids, or objects with a check_id. */
const ruleIds = (items: unknown[]) =>
  items.map((x) => (typeof x === "string" ? x : (x as { check_id?: string } | null)?.check_id)).filter((x): x is string => !!x);

const costText = (r: ProvenCostRow) =>
  r.currency ? money(r.amount, r.currency) : Object.entries(r.by_currency ?? {}).map(([c, n]) => money(n, c)).join(", ") || f1(null);

export function Insights() {
  const cost = useInsight("proven-cost", getProvenCost, { currency: null, rows: [], cost_by_l1: [], value_at_risk_by_l1: [] });
  const impact = useInsight("impact", getImpact, { rows: [] });
  const causes = useInsight("root-causes", getCauseClusters, { clusters: [] });

  if (cost.isPending) return <CcPage title={t("Cost and causes")}><Skeleton width="100%" height={320} /></CcPage>;
  if (cost.isError) {
    return (
      <CcPage title={t("Cost and causes")}>
        {status(cost.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read what bad data costs.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void cost.refetch()}>{t("What bad data costs could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const c = cost.data;
  const cur = c.currency;
  const risk = [...c.value_at_risk_by_l1].sort((a, b) => b.value_at_risk - a.value_at_risk);
  const lost = [...c.cost_by_l1].sort((a, b) => b.amount - a.amount);
  const areas = [...new Set([...risk.map((r) => r.l1), ...lost.map((r) => r.l1)])];
  const top = risk[0];
  return (
    <CcPage title={t("Cost and causes")}>
      <Guide
        shows={t("Shows where failing rules put money at risk, what has already been lost in posted documents, and the fields behind the failures.")}
        next={{ href: "/value", label: t("Open value delivered") }}
        why={t("This screen only reads. Open a cause to see the records behind it.")}
        means={[
          [t("Largest value at risk"), t("The business area with the most money at risk from failing rules.")],
          [t("Largest proven cost"), t("The business area with the most money already lost in posted documents.")],
          [t("Root causes"), t("Failing rules grouped by the field they fail on.")],
        ]}
      />
      <CcBanner
        eyebrow={t("Cost and causes")}
        headline={top && top.value_at_risk > 0 ? t("{area} carries the most value at risk", { area: area(top.l1) }) : t("No priced SAP feature is at risk")}
        why={t("Value at risk is what the SAP features blocked or degraded by failing rules are worth. Proven cost is money already lost in posted documents. Each is shown per business area and never added across areas.")}
        figs={[
          { label: t("Largest value at risk"), value: top ? moneyCompactText(top.value_at_risk, cur) : f1(null), note: top ? area(top.l1) : undefined },
          { label: t("Largest proven cost"), value: lost[0] ? moneyCompactText(lost[0].amount, cur) : f1(null), note: lost[0] ? area(lost[0].l1) : undefined },
          { label: t("SAP features at risk"), value: impact.data ? int(impact.data.rows.length) : f1(null) },
          { label: t("Root causes"), value: causes.data ? int(causes.data.clusters.length) : f1(null) },
        ]}
        testId="ins-banner"
        label={t("Cost and causes")}
      />
      <Section q={cost} title={t("By business area")} meta={cur ? t("In {currency}", { currency: cur }) : undefined} testId="ins-areas">
        {() => areas.length === 0 ? <EmptyFrame>{t("No cost or value at risk has been measured yet.")}</EmptyFrame> : (
          <Table title={t("By business area")} head={[t("Business area"), t("Proven cost"), t("Value at risk")]}>
            {areas.map((k) => {
              const p = lost.find((r) => r.l1 === k);
              const v = risk.find((r) => r.l1 === k);
              return (
                <tr key={k}>
                  <th scope="row" className="m2-card-lead">{area(k)}</th>
                  <td data-label={t("Proven cost")} className="m2-num">{p && cur ? money(p.amount, cur) : f1(null)}</td>
                  <td data-label={t("Value at risk")} className="m2-num">{v && cur ? money(v.value_at_risk, cur) : f1(null)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
      <ImpactPanel q={impact} cur={cur} />
      <CausesPanel q={causes} />
      <Disclose title={t("Money already lost")} hint={t("Proven cost in posted documents, by business area.")}>
        <ProvenCostPanel rows={c.rows} />
      </Disclose>
      <Disclose title={t("Trend over time")} hint={t("How the cost and the causes moved run by run.")}>
        <TrendPanel />
      </Disclose>
      <Disclose title={t("What moves the score")} hint={t("Normal ranges and lead and lag links the Aletheia engine learned from the run trend.")}>
        <DriversPanel />
      </Disclose>
    </CcPage>
  );
}

function ProvenCostPanel({ rows }: { rows: ProvenCostRow[] }) {
  const rule = useRuleName();
  const title = t("Money already lost");
  return (
    <Section q={{ isPending: false, isError: false, error: null, data: rows, refetch: () => undefined }} title={title} meta={t("Measured in posted documents and traced to the rules behind them")} testId="ins-proven">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No posted document shows a cost from bad data yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Cost"), t("Business area"), t("Amount"), t("Documents"), t("Rules")]}>
          {d.map((r) => (
            <tr key={r.metric}>
              <th scope="row" className="m2-card-lead">{METRIC[r.metric]?.() ?? r.label}</th>
              <td data-label={t("Business area")}>{area(r.l1)}</td>
              <td data-label={t("Amount")} className="m2-num">{costText(r)}</td>
              <td data-label={t("Documents")} className="m2-num">{r.documents == null ? f1(null) : int(r.documents)}</td>
              <td data-label={t("Rules")}>
                {r.check_ids.length === 0 ? f1(null) : <ul className="m2-plain">{r.check_ids.map((id) => <li key={id}>{rule(id)}</li>)}</ul>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

type Q<T> = { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };

function ImpactPanel({ q, cur }: { q: Q<{ rows: import("@/lib/api/v2/insights").ImpactRow[] }>; cur: string | null }) {
  const rule = useRuleName();
  const title = t("SAP features at risk");
  const m = (n: number) => (cur ? money(n, cur) : int(n));
  return (
    <Section q={q} title={title} meta={t("Features the failing rules block or degrade, worth the records they touch")} testId="ins-impact">
      {(d) => d.rows.length === 0 ? <EmptyFrame>{t("No priced SAP feature is blocked or degraded.")}</EmptyFrame> : (
        <Table title={title} head={[t("Feature"), t("Business area"), t("Status"), t("Records"), t("Value a record"), t("Value at risk"), t("Rules")]}>
          {[...d.rows].sort((a, b) => b.value_at_risk - a.value_at_risk).map((r) => (
            <tr key={r.feature}>
              <th scope="row" className="m2-card-lead">{r.feature}</th>
              <td data-label={t("Business area")}>{area(r.l1)}</td>
              <td data-label={t("Status")}>{FEATURE_STATUS[r.status]?.() ?? r.status}</td>
              <td data-label={t("Records")} className="m2-num">{int(r.record_count)}</td>
              <td data-label={t("Value a record")} className="m2-num">{m(r.value_per_record)}</td>
              <td data-label={t("Value at risk")} className="m2-num">{m(r.value_at_risk)}</td>
              <td data-label={t("Rules")}>
                {ruleIds(r.causing_rules).length === 0 ? f1(null) : <ul className="m2-plain">{ruleIds(r.causing_rules).map((id) => <li key={id}>{rule(id)}</li>)}</ul>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function CausesPanel({ q }: { q: Q<{ clusters: import("@/lib/api/v2/insights").CauseCluster[] }> }) {
  const rule = useRuleName();
  const title = t("Root causes");
  return (
    <Section q={q} title={title} meta={t("Failing rules grouped by the field they fail on, worst first")} testId="ins-causes">
      {(d) => d.clusters.length === 0 ? <EmptyFrame>{t("No failing rule to group yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Field"), t("Rules"), t("Severity"), t("Records"), t("Fixable automatically"), t("Where it comes from")]}>
          {d.clusters.map((k) => (
            <tr key={k.key}>
              <th scope="row" className="m2-card-lead">
                {k.kind === "field" && k.table && k.field ? <Coded code={`${k.table}-${k.field}`} text={null} /> : t("No single field")}{" "}
                <span className="m2-meta">{formatModuleName(k.module)}</span>
              </th>
              <td data-label={t("Rules")}><ul className="m2-plain">{k.rules.map((id) => <li key={id}>{rule(id)}</li>)}</ul></td>
              <td data-label={t("Severity")}><Sev severity={k.severity} /></td>
              <td data-label={t("Records")} className="m2-num">{k.records_estimated ? t("about {n}", { n: int(k.records) }) : int(k.records)}</td>
              <td data-label={t("Fixable automatically")} className="m2-num">{pctOf(k.auto_fix_pct)}</td>
              <td data-label={t("Where it comes from")}>
                {k.origin?.status === "computed" && k.origin.top ? <>{k.origin.top} <span className="m2-meta">{pct1(k.origin.share)}</span></> : f1(null)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function TrendPanel() {
  const q = useInsight("trends", getTrends, { runs: [] });
  const runs = q.data?.runs ?? [];
  const pts = runs.filter((r) => r.composite != null).map((r) => {
    const label = r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.version_id);
    return { id: r.version_id, label, title: t("{day}: score {score}", { day: label, score: f1(r.composite) }), value: r.composite as number };
  });
  const ticks = niceTicks(Math.min(...pts.map((p) => p.value), 100) - 2, Math.max(...pts.map((p) => p.value), 0), 4);
  const title = t("Score run by run");
  if (q.isPending) return <Skeleton width="100%" height={180} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The score history could not be read.")}</ErrorFrame>;
  return (
    <ChartFrame
      title={title}
      sub={t("The last {n} runs, with the rules each one fixed and found", { n: int(runs.length) })}
      height={180}
      level={2}
      state={pts.length < 2 ? "empty" : "ready"}
      empty={t("Two scored runs are needed to draw a trend.")}
      testId="ins-trend"
      table={<ChartTable caption={title} head={[t("Run"), t("Score"), t("Change"), t("Rules fixed"), t("Rules newly failing")]} rows={runs.map((r) => [r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.version_id), f1(r.composite), f1(r.change), r.rules_fixed == null ? f1(null) : int(r.rules_fixed), r.rules_new == null ? f1(null) : int(r.rules_new)])} />}
    >
      <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={180} label={title} yLabel={t("score")} format={f1} />
    </ChartFrame>
  );
}

const ENGINE_OFF: Record<EngineOffReason, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the engine can learn from the trend."),
  not_configured: () => t("This deployment runs without its Aletheia engine. An administrator can set it up."),
  unreachable: () => t("The Aletheia engine does not answer. The rest of this page is not affected."),
  no_token: () => t("The Aletheia engine has no access token, so it cannot learn from the trend yet."),
  licence_invalid: () => t("The Aletheia engine licence is not valid, so the engine is not used."),
  engine_error: () => t("The Aletheia engine could not learn from the trend this time."),
};

/** The engine learns only from run-level scores and counts; it never sees a record. */
function DriversPanel() {
  const q = useInsight<EngineDrivers>("engine-drivers", getEngineDrivers, { labels: {}, available: false, reason: "too_few_runs" });
  const title = t("What moves the score");
  const name = (d: EngineDrivers, m: string) => <Coded code={m} text={m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : d.labels[m]} />;
  return (
    <Section q={q} title={title} meta={t("Learned by the Aletheia engine from the last {n} runs", { n: int(q.data?.runs ?? 0) })} testId="ins-drivers">
      {(d) => !d.available ? <EmptyFrame>{ENGINE_OFF[d.reason ?? "engine_error"]?.() ?? ENGINE_OFF.engine_error()}</EmptyFrame> : (
        <>
          <Table title={t("Normal range per measure")} head={[t("Measure"), t("Normal range"), t("Latest run"), t("Verdict")]}>
            {(d.ranges ?? []).map((r) => (
              <tr key={r.metric}>
                <th scope="row" className="m2-card-lead">{name(d, r.metric)}</th>
                <td data-label={t("Normal range")} className="m2-num">{t("{low} to {high}", { low: f1(r.low), high: f1(r.high) })}</td>
                <td data-label={t("Latest run")} className="m2-num">{f1(r.latest)}</td>
                <td data-label={t("Verdict")}>{r.outside ? t("Outside the normal range") : t("Within the normal range")}</td>
              </tr>
            ))}
          </Table>
          {(d.links ?? []).length === 0 ? <EmptyFrame>{t("The engine found no measure that leads another.")}</EmptyFrame> : (
            <Table title={t("Measures that move together")} head={[t("Measure"), t("Moves"), t("Runs later"), t("Correlation")]}>
              {(d.links ?? []).map((e) => (
                <tr key={`${e.source}-${e.target}-${e.lag}`}>
                  <th scope="row" className="m2-card-lead">{name(d, e.source)}</th>
                  <td data-label={t("Moves")}>{name(d, e.target)}</td>
                  <td data-label={t("Runs later")} className="m2-num">{e.lag == null ? f1(null) : int(e.lag)}</td>
                  <td data-label={t("Correlation")} className="m2-num">{e.correlation == null ? f1(null) : e.correlation.toFixed(2)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Section>
  );
}
